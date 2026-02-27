import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
config({ path: path.join(rootDir, ".env") });
