/** Vite의 ?raw 가져오기는 파일 내용을 문자열로 돌려준다. 테스트가 fixture 원문을 IO 없이 읽는 데 쓴다. */
declare module '*.yaml?raw' {
  const source: string;
  export default source;
}
