import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
dotenv.config({ path: path.join(rootDir, ".env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
