import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** UI가 책임지는 대표 경로·관계·진단만 제공한다. */
export function uiFiles() {
  return {
    'source %20 한글#.java':
      'class Probe {\n  zoneAuxiliary();\n  direct();\n}\n',
    '.codocs/zone %20 한글#.yaml':
      'id: zone\nname: Zone\ndefinition: Zone body [[Direct]]\ndomains: [test]\n',
    '.codocs/direct.yaml':
      'id: direct\nname: Direct\ndefinition: Direct body\ndomains: [test]\n',
    '.codocs/auxiliary.yaml':
      'id: auxiliary\nname: Auxiliary\ndefinition: Auxiliary body\ndomains: [test]\n',
    '.codocs/referrer.yaml':
      'id: referrer\nname: Referrer\ndefinition: Backlink [[Zone]]\ndomains: [test]\n',
    '.codocs/source %20 한글#.yaml':
      'id: source\nname: Source\ndefinition: Body [[Zone]]\ndomains: [test]\n',
    '.codocs/ambiguous.yaml':
      'id: ambiguous\nname: Ambiguous\ndefinition: Body [[Twin]]\ndomains: [test]\n',
    '.codocs/twin-a.yaml':
      'id: twin-a\nname: Twin\ndefinition: Twin A body\ndomains: [alpha]\n',
    '.codocs/twin-b.yaml':
      'id: twin-b\nname: Twin\ndefinition: Twin B body\ndomains: [beta]\n',
    '.codocs/old.yaml':
      'id: old\nname: Old\ndefinition: Old body\nstatus: deprecated\ndomains: [test]\n',
    '.codocs/old-source.yaml':
      'id: old-source\nname: Old Source\ndefinition: Body [[Old]]\ndomains: [test]\n',
    'nested/source.java': 'zone();\n',
    'nested/.codocs/zone.yaml':
      'id: zone\nname: Nested Zone\ndefinition: Nested workspace body\ndomains: [nested]\n',
  };
}

/** job가 소유한 workspace를 만들거나 변경 파일을 기준 내용으로 복원한다. */
export async function createFixture(root) {
  for (const [relative, content] of Object.entries(uiFiles())) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}
