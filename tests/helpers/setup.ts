import { loadEnv } from "../../sync/env";

loadEnv();
// Library code reads DATABASE_URL; in tests it must always be the throwaway test database.
if (!process.env.TEST_DATABASE_URL || !/blight_test/.test(process.env.TEST_DATABASE_URL)) {
  throw new Error("TEST_DATABASE_URL must point at the blight_test database");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
