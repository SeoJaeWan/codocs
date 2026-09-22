/** 실행별 기본 문서와 편집할 코드의 고정 데이터를 제공한다. */
export function fixtureFiles() {
  return {
    'nested/.codocs/nested-zone.yaml':
      'id: zone\nname: Nested Zone\ndefinition: Nested workspace body\ndomains: [nested]\n',
    'nested/nested.java': 'zone();\n',
    'partial/.codocs/zone.yaml':
      'id: zone\nname: Zone\ndefinition: Zone body\ndomains: [test]\n',
    'partial/.codocs/unreadable.yaml':
      'id: locked\nname: Locked\ndefinition: Not readable\ndomains: [test]\n',
    'partial/probe.java': 'zone();\n',
    '.codocs/ready.yaml':
      'id: ready-signal\nname: Ready Signal\ndefinition: UI ready sentinel\ndomains: [test]\n',
    '.codocs/zone.yaml':
      'id: zone\nname: Zone\ndefinition: Zone body [[Direct]]\ndomains: [test]\n',
    '.codocs/direct.yaml':
      'id: direct\nname: Direct\ndefinition: Direct body\ndomains: [test]\n',
    '.codocs/referrer.yaml':
      'id: referrer\nname: Referrer\ndefinition: Backlink [[Zone]]\ndomains: [test]\n',
    '.codocs/auxiliary.yaml':
      'id: auxiliary\nname: Auxiliary\ndefinition: Auxiliary body\ndomains: [test]\n',
    '.codocs/source.yaml':
      'id: source\nname: Source\ndefinition: Body [[Zone]] and [[Zone]]\nexamples:\n  - Example [[Zone]]\ndomains: [test]\ncustom: Metadata [[Zone]]\n',
    '.codocs/ambiguous.yaml':
      'id: ambiguous-source\nname: Ambiguous Source\ndefinition: Body [[Twin]]\ndomains: [test]\n',
    '.codocs/twin-a.yaml':
      'id: twin-a\nname: Twin\ndefinition: Twin A body\ndomains: [alpha]\n',
    '.codocs/twin-b.yaml':
      'id: twin-b\nname: Twin\ndefinition: Twin B body\ndomains: [beta]\n',
    '.codocs/current.yaml':
      'id: current\nname: Current\ndefinition: Current body\ndomains: [test]\ndeprecatedAliases:\n  - id: current\n  - id: previous\n',
    '.codocs/duplicate-a.yaml':
      'id: duplicate\nname: Duplicate\ndefinition: First duplicate body\ndomains: [test]\n',
    '.codocs/duplicate-b.yaml':
      'id: duplicate\nname: Duplicate\ndefinition: Second duplicate body\ndomains: [test]\n',
    '.codocs/old.yaml':
      'id: old\nname: Old\ndefinition: Old body\nstatus: deprecated\ndomains: [test]\n',
    '.codocs/old-source.yaml':
      'id: old-source\nname: Old Source\ndefinition: Body [[Old]]\ndomains: [test]\n',
    '.codocs/missing.yaml':
      'id: missing-source\nname: Missing Source\ndefinition: Body [[Absent]]\ndomains: [test]\n',
    '.codocs/invalid.yaml':
      'id: Invalid_ID\nname: Invalid\ndefinition: Invalid body retained\ndomains: [test]\ndeprecatedAliases:\n  - id: legacy-invalid\n',
    '.codocs/invalid-source.yaml':
      'id: invalid-source\nname: Invalid Source\ndefinition: Body [[Invalid]]\ndomains: [test]\n',
    '.codocs/broken.yaml': 'id: broken\nname: Broken\ndomains: [test]\n',
    'source.java':
      'class Probe {\n  readySignal();\n  zoneAuxiliary();\n  currentPrevious();\n  previous();\n  duplicateAuxiliary();\n  broken();\n  legacyInvalid();\n  utterlyUnmatched();\n}\n',
    'native.ts': 'function nativeFunction() { return 1; }\nnativeFunction();\n',
  };
}
