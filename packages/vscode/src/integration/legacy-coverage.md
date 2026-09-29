# 이전 설치 Host 검사

이전 provider/command 중심 설치 기능 묶음은 실제 renderer 입력을 사용하는 대표 UI 검사와 인접 책임 검사로 정리했다. 기존 상세 입력 조합의 assertion 소유권, 현재 UI 사례, 검증 한계는 [coverage.md](coverage.md)에 기록한다. 현재 CI 실행 계약은 [verification.md](verification.md)에 있다.

과거 설치·Playwright 구현과 실행 결과는 Git 이력의 증거이며 현재 후보의 화면 수락 결과를 대신하지 않는다. 현재 UI 검사도 Windows/macOS 정확한 후보 실행 전에는 미검증이다.
