import path from "path";
import { defineConfig, env } from "prisma/config";
import { config } from "dotenv";

const rootDir = path.resolve(__dirname);
config({ path: path.join(rootDir, ".env") });

export default defineConfig({
  schema: path.join(rootDir, "prisma", "schema.prisma"),
  datasource: {
    url: env("DATABASE_URL"),
  },
});
