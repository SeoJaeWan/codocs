using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// 전용 데스크톱과 Job Object 안에서 준비부터 자식 종료까지 관측한다.
public static class IsolatedDesktop {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Startup { public int cb; public string reserved, desktop, title; public uint x,y,width,height,columns,rows,fill,flags; public ushort show,reservedSize; public IntPtr reservedBytes,input,output,error; }
  [StructLayout(LayoutKind.Sequential)]
  public struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)]
  public struct BasicLimits { public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking; public uint activeLimit; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)]
  public struct IoCounters { public ulong readOperations,writeOperations,otherOperations,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)]
  public struct ExtendedLimits { public BasicLimits basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory; }
  [StructLayout(LayoutKind.Sequential)]
  public struct Accounting { public long userTime,kernelTime,periodUserTime,periodKernelTime; public uint pageFaults,total,active,terminated; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr security);
  [DllImport("user32.dll", SetLastError=true)] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting accounting, uint length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint millis);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern void SetLastError(uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder value, int length, out int needed);
  public delegate bool WindowCallback(IntPtr window, IntPtr data);
  [DllImport("user32.dll", SetLastError=true)] static extern bool EnumDesktopWindows(IntPtr desktop, WindowCallback callback, IntPtr data);
  public class Sample { public long ms,window; public uint pid; public string inputDesktop,phase; }
  public class Window { public long handle; public uint pid; }
  public class Report { public string desktop,reason,error; public uint childPid,exitCode=1,residualProcesses=uint.MaxValue; public bool desktopClosed; public List<Sample> samples=new List<Sample>(); public List<Window> windows=new List<Window>(); }
  // 명령행 인수를 Windows CRT 규칙으로 인용한다.
  static string Quote(string value) {
    var result=new StringBuilder("\""); int slashes=0;
    foreach(char c in value) {
      if(c=='\\') { slashes++; continue; }
      if(c=='"') { result.Append('\\',slashes*2+1); result.Append(c); slashes=0; continue; }
      result.Append('\\',slashes); slashes=0; result.Append(c);
    }
    result.Append('\\',slashes*2); return result.Append('"').ToString();
  }
  static string InputDesktop() {
    var desktop=OpenInputDesktop(0,false,1);
    if(desktop==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"OpenInputDesktop");
    try { var name=new StringBuilder(256); int needed; if(!GetUserObjectInformationW(desktop,2,name,512,out needed)) throw new Win32Exception(Marshal.GetLastWin32Error()); return name.ToString(); }
    finally { CloseDesktop(desktop); }
  }
  static uint Active(IntPtr job) { Accounting accounting; if(!QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error()); return accounting.active; }
  public static Report Run(string executable,string[] arguments,string cwd,string cancelPath,int parentPid,int timeout) {
    var report=new Report { desktop="CodocsTest-"+Guid.NewGuid().ToString("N"), reason="preparation" };
    var watch=Stopwatch.StartNew(); IntPtr desktop=IntPtr.Zero,job=IntPtr.Zero; var process=new ProcessInfo();
    var parent=Process.GetProcessById(parentPid); var seen=new HashSet<long>();
    Action<string> sample=phase=>{
      uint pid; var window=GetForegroundWindow(); GetWindowThreadProcessId(window,out pid);
      report.samples.Add(new Sample { ms=watch.ElapsedMilliseconds,window=window.ToInt64(),pid=pid,inputDesktop=InputDesktop(),phase=phase });
      SetLastError(0);
      if(desktop!=IntPtr.Zero && !EnumDesktopWindows(desktop,(hwnd,data)=>{ uint owner; GetWindowThreadProcessId(hwnd,out owner); if(seen.Add(hwnd.ToInt64())) report.windows.Add(new Window{handle=hwnd.ToInt64(),pid=owner}); return true; },IntPtr.Zero)) { var code=Marshal.GetLastWin32Error(); if(code!=0) report.error="EnumDesktopWindows: "+code; }
    };
    try {
      sample("before-create");
      desktop=CreateDesktopW(report.desktop,IntPtr.Zero,IntPtr.Zero,0,0x1ff,IntPtr.Zero);
      if(desktop==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"CreateDesktop");
      job=CreateJobObjectW(IntPtr.Zero,null);
      if(job==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"CreateJobObject");
      var limits=new ExtendedLimits(); limits.basic.flags=0x2000; // 마지막 핸들이 닫혀도 전체 자식 트리를 종료한다.
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits)))) throw new Win32Exception(Marshal.GetLastWin32Error(),"Job limits");
      var command=new StringBuilder(Quote(executable)); foreach(var argument in arguments) command.Append(" ").Append(Quote(argument));
      var startup=new Startup { cb=Marshal.SizeOf(typeof(Startup)),desktop="winsta0\\"+report.desktop,flags=0x80 };
      // 실행을 재개하기 전에 Job에 넣어 짧게 실행한 자식도 포함한다.
      if(!CreateProcessW(executable,command,IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,cwd,ref startup,out process)) throw new Win32Exception(Marshal.GetLastWin32Error(),"CreateProcess");
      report.childPid=process.pid;
      if(!AssignProcessToJobObject(job,process.process)) throw new Win32Exception(Marshal.GetLastWin32Error(),"AssignProcessToJobObject");
      if(ResumeThread(process.thread)==0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error(),"ResumeThread");
      report.reason="exit";
      while(WaitForSingleObject(process.process,25)==258) {
        sample("running");
        if(parent.HasExited || File.Exists(cancelPath)) { report.reason="cancelled"; break; }
        if(watch.ElapsedMilliseconds>timeout) { report.reason="timeout"; break; }
      }
      if(report.reason=="exit") { uint code; if(!GetExitCodeProcess(process.process,out code)) throw new Win32Exception(Marshal.GetLastWin32Error()); report.exitCode=code; }
    } catch(Exception error) { report.error=error.ToString(); }
    finally {
      Action<string> cleanupSample=phase=>{ try { sample(phase); } catch(Exception error) { report.error=(report.error??"")+"\nobservation: "+error; } };
      cleanupSample("cleanup");
      try {
        // 정상 종료 때 남은 서버·렌더러도 작업 소유 Job 안에서만 종료한다.
        if(job!=IntPtr.Zero) {
          if(!TerminateJobObject(job,1)) throw new Win32Exception(Marshal.GetLastWin32Error(),"TerminateJobObject");
          var cleanup=Stopwatch.StartNew();
          while(Active(job)>0 && cleanup.ElapsedMilliseconds<10000) { cleanupSample("cleanup"); Thread.Sleep(25); }
          report.residualProcesses=Active(job);
        }
        // Job 종료는 비동기다. 이미 종료 중인 프로세스의 TerminateProcess 실패를 누수로 오인하지 않는다.
        if(process.process!=IntPtr.Zero && WaitForSingleObject(process.process,5000)!=0) {
          TerminateProcess(process.process,1);
          if(WaitForSingleObject(process.process,5000)!=0) throw new Win32Exception(Marshal.GetLastWin32Error(),"Created process cleanup");
        }
        for(int i=0;i<4;i++) { cleanupSample("after-exit"); Thread.Sleep(25); }
      } catch(Exception error) { report.error=(report.error??"")+"\ncleanup: "+error; }
      if(process.thread!=IntPtr.Zero) CloseHandle(process.thread);
      if(process.process!=IntPtr.Zero) CloseHandle(process.process);
      if(job!=IntPtr.Zero) CloseHandle(job);
      if(desktop!=IntPtr.Zero) report.desktopClosed=CloseDesktop(desktop);
      parent.Dispose();
    }
    return report;
  }
}
