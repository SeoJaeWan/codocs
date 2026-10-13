# 공통 테스트 실행 도구

- `read-denial.cjs`: 읽기 실패 fixture. Windows에서는 핸들 공유를 허용한 데이터 범위 잠금, Mac에서는 권한 제한을 사용하고 해제 시 복원한다. 테스트는 platform과 OS 호출을 주입해 Windows 잠금과 macOS 권한 경로를 한 OS에서 확인하며, 실제 OS의 읽기 거부 동작에는 의존하지 않는다.
