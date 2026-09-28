import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/** 배포 대상 디렉터리 전체를 정렬한 상대 파일 목록으로 읽는다. */
export function guideAssetFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap(
      /** 하위 디렉터리 경로를 부모 기준으로 합친다. */ (entry) => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory()
          ? guideAssetFiles(target).map((file) => entry.name + '/' + file)
          : [entry.name];
      },
    )
    .sort();
}

/** 원본과 설치 자산의 전체 목록·바이트·상대 링크 대상을 비교한다. */
export function assertGuideAssets(source: string, deployed: string): void {
  for (const relative of ['docs/guide', 'examples/.codocs']) {
    const originals = guideAssetFiles(path.join(source, relative));
    const shipped = guideAssetFiles(path.join(deployed, relative));
    assert.deepEqual(shipped, originals);
    for (const file of originals) {
      const target = path.join(deployed, relative, file);
      assert.deepEqual(
        readFileSync(target),
        readFileSync(path.join(source, relative, file)),
      );
      if (file.endsWith('.md')) {
        for (const match of readFileSync(target, 'utf8').matchAll(
          /\]\(([^)]+)\)/g,
        )) {
          const link = match[1]!.split('#')[0]!;
          if (link && !/^[a-z]+:/i.test(link))
            assert.ok(
              existsSync(
                path.resolve(path.dirname(target), decodeURIComponent(link)),
              ),
              '배포 링크: ' + link,
            );
        }
      }
    }
  }
}

/** 외부 소비자의 공개 파서·검증기·색인으로 모든 YAML과 독립 기대 관계를 확인한다. */
export const exampleContractScript = `import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {parseYaml,validateDocument,buildCatalog,getKeyRange,getValueRange,getPropertyRange} from '@codocs/core';
const root=process.argv[2];
const files=readdirSync(path.join(root,'examples/.codocs'),{recursive:true}).filter(file=>/\\.ya?ml$/.test(file)).sort();
assert.deepEqual(files,['fulfillment.yaml','order.yaml','receipt.yaml','shipping-policy.yaml']);
const expected={
 'sample-fulfillment':{references:['sample-order','sample-shipping-policy'],referencedBy:['sample-order'],occurrences:2},
 'sample-order':{references:['sample-fulfillment','sample-receipt'],referencedBy:['sample-fulfillment','sample-receipt','sample-shipping-policy'],occurrences:2},
 'sample-receipt':{references:['sample-order'],referencedBy:['sample-order'],occurrences:1},
 'sample-shipping-policy':{references:['sample-order'],referencedBy:['sample-fulfillment'],occurrences:1},
};
const observations=files.map(file=>{
 const source=readFileSync(path.join(root,'examples/.codocs',file),'utf8');
 const parsed=parseYaml(source,file);
 assert.equal(parsed.success,true,JSON.stringify(parsed.diagnostics));
 assert.deepEqual(parsed.diagnostics,[]);
 assert.equal(parsed.source,source);
 const before=structuredClone(parsed);
 const validated=validateDocument({data:parsed.data,source:parsed.source,fields:parsed.fields,path:file,...(parsed.rootRange?{rootRange:parsed.rootRange}:{})});
 assert.equal(validated.success,true,JSON.stringify(validated.errors));
 assert.deepEqual(validated.errors,[]);assert.deepEqual(validated.warnings,[]);
 assert.deepEqual(validated.data,parsed.data);assert.deepEqual(parsed,before);
 const key=getKeyRange(parsed,['id']), value=getValueRange(parsed,['id']), property=getPropertyRange(parsed,['id']);
 assert.ok(key&&value&&property);
 assert.equal(source.slice(key.start,key.end),'id');
 assert.equal(source.slice(value.start,value.end),parsed.data.id);
 const newline=source.includes('\\r\\n')?'\\r\\n':'\\n';
 assert.equal(source.slice(property.start,property.end),'id: '+parsed.data.id+newline);
 return {path:file,parsed};
});
const catalog=buildCatalog({status:'complete',observations});
assert.equal(catalog.documents.size,4);
for(const doc of catalog.documents.values()){
 const contract=expected[doc.id];assert.ok(contract,doc.id);
 assert.deepEqual(doc.references.map(value=>value.id).sort(),contract.references);
 assert.deepEqual(doc.referencedBy.map(value=>value.id).sort(),contract.referencedBy);
 assert.equal(doc.occurrences.length,contract.occurrences);
 assert.ok(doc.occurrences.every(item=>item.resolution.status==='resolved'));
 assert.deepEqual(doc.diagnostics.map(d=>[d.code,d.severity]),doc.id==='sample-order'?[['deprecated_reference','warning']]:[]);
}
console.log('4 examples parsed and validated');
`;

/** 외부 설치된 MCP CLI에서 모든 topic과 실패 입력을 실제 stdio로 검사한다. */
export const installedGuideScript = `import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const mcp=import.meta.resolve('@codocs/mcp');
const require=createRequire(mcp);
const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const {StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
const dist=path.dirname(fileURLToPath(mcp));
const client=new Client({name:'installed-guide',version:'1'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(dist,'cli.js')],cwd:process.cwd(),stderr:'pipe'}));
try {
 const topics={overview:'README.md',schema:'schema.md',writing:'writing.md',examples:'examples.md',updating:'updating.md',validation:'validation.md'};
 assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['codocs_list','codocs_get','codocs_refresh','codocs_validate','codocs_write','codocs_guide']);
 for(const topic of [undefined,...Object.keys(topics)]){
   const response=await client.callTool({name:'codocs_guide',arguments:topic?{topic}:{}});
   assert.deepEqual(JSON.parse(response.content[0].text),response.structuredContent);
   assert.equal(response.isError,false);
   const body=response.structuredContent;assert.equal(body.success,true);assert.equal(body.topic,topic??'overview');
   assert.deepEqual(body.topics,Object.keys(topics));
   assert.equal(body.content,readFileSync(path.join(dist,'docs/guide',topics[topic??'overview']),'utf8'));
 }
 for(const input of [{topic:'unknown'},{topic:'schema',extra:true}]){
   const response=await client.callTool({name:'codocs_guide',arguments:input});
   assert.equal(response.isError,true);assert.equal(response.structuredContent.error.code,'invalid_input');
 }
 console.log('Installed CLI guide topics verified');
} finally {await client.close();}
`;
