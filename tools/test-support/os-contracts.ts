/** 로컬 경계 사례와 CI 실제 관측이 공유하는 운영체제별 입력 의미다. */
export const osContracts = [
  {
    platform: 'win32',
    root: 'C:\\자료 공간',
    codocs: 'C:\\자료 공간\\.codocs',
    logical: 'C:\\자료 공간\\.codocs\\연결',
    target: 'C:\\외부 자료',
    child: 'C:\\외부 자료\\한글.yaml',
    input: '.codocs/연결/한글.yaml',
    discovered: '.codocs\\연결\\한글.yaml',
    readlink: 'C:\\외부 자료',
    linkType: 'junction',
    deniedCodes: ['EACCES', 'EPERM'],
    signal: 'SIGTERM',
    exitCode: null,
    handled: false,
  },
  {
    platform: 'darwin',
    root: '/자료 공간',
    codocs: '/자료 공간/.codocs',
    logical: '/자료 공간/.codocs/연결',
    target: '/외부 자료',
    child: '/외부 자료/한글.yaml',
    input: '.codocs/연결/한글.yaml',
    discovered: '.codocs/연결/한글.yaml',
    readlink: '../../외부 자료',
    linkType: 'dir',
    deniedCodes: ['EACCES'],
    signal: null,
    exitCode: 0,
    handled: true,
  },
] as const;
/** 두 플랫폼에서 바이트 그대로 보존해야 하는 원문이다. */
export const contractRaw = 'id: shared\r\nname: 한글\r\ndefinition: 원문\r\n';
