// 자동 테스트 설정. tests 폴더 안의 *.test.ts 파일만 실행하고, 코드의 "@/" 주소는 프로젝트 맨 위 폴더로 연결한다.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
