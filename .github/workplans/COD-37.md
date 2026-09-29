# COD-37 — 배포 workflow 첫 게시 실패 수정(VSIX 검증과 Version PR job)

Version PR #47 병합으로 main이 0.0.2가 된 뒤 release.yml 첫 게시 실행(run 36564268896)이 실패했다. 파일 검증에서 멈춰 npm·Marketplace 게시와 태그·Release 생성은 실행되지 않았고 두 제품은 0.0.1로 남아 있다.

- Publish job: tools/build/verify-release.mjs가 VSIX 목록 확인과 압축 해제에 시스템 tar(tar -tf, tar -xf)를 쓴다. VSIX는 zip이라 macOS·Windows의 bsdtar는 읽지만 Ubuntu의 GNU tar는 읽지 못한다. 그동안 release:verify는 Windows·macOS에서만 실행되어 드러나지 않았고, COD-35에서 publish job을 Ubuntu에 두면서 처음 실패했다.
- Version PR job: Version PR 병합으로 changeset이 모두 소비된 뒤 main push에서 changeset version이 No unreleased changesets found로 exit 1을 낸다. 새 changeset이 들어오기 전까지 main push마다 Release 실행이 실패로 표시된다.

## 범위

- verify-release.mjs가 VSIX를 시스템 tar 대신 yauzl로 읽어 목록 확인과 압축 해제를 한다. yauzl 2.10.0은 루트 devDependency로 추가한다(DEC-01). @vscode/vsce의 readZip은 항목 이름을 소문자로 바꿔 대소문자를 구분하는 Linux에서 README.md·LICENSE·THIRD-PARTY-NOTICES.txt 조회가 실패하므로 쓰지 않는다. 이름의 대소문자는 그대로 두고, 절대 경로와 대상 폴더 밖으로 나가는 항목은 거부하며, 폴더 항목은 폴더만 만든다. tgz는 그대로 tar로 읽고 검사 내용은 바꾸지 않는다.
- ci.yml의 pack job에서 release:pack 뒤에 release:verify를 실행해, 게시 job과 같은 Ubuntu 환경에서 tgz와 VSIX를 병합 전에 검증한다(DEC-02).
- release.yml의 version job에 미출시 changeset 확인 단계를 두고, .changeset 안에 README.md가 아닌 .md 파일이 있을 때만 version Action을 실행한다(DEC-03).
- 도구 변경이므로 changeset은 추가하지 않는다.

## 진행 기준

- main을 대상으로 PR을 보내고 merge commit으로 병합한다.
- 병합으로 생긴 main push에서 release.yml이 main의 0.0.2를 게시한다. 실패한 실행의 재실행은 수정 전 커밋으로 돌기 때문에 쓰지 않는다.

## 검증

- PR 안: CI 통과(Ubuntu pack job의 release:verify와 Windows·macOS의 release:verify 포함). 새 node 테스트가 이름 대소문자 보존과 위험 경로 거부를 확인한다. changeset이 없을 때 확인 단계가 pending=false를 내고 version Action을 건너뛰는지 확인한다.
- 병합 후: Release 실행 성공, npm co-documentation 0.0.2·Marketplace seojaewan.codocs 0.0.2, co-documentation@0.0.2·codocs@0.0.2 태그와 Release 본문(CHANGELOG 항목과 설치 안내), 첨부 파일과 SHA-256.

## 완료 기준

- main push에서 Version PR job이 changeset이 없을 때 실패하지 않는다.
- 두 제품 0.0.2가 게시되고 제품별 태그·Release가 생성된다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-37
