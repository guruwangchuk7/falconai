import "dotenv/config";
import { migrate } from "./migrate";
import { closePool } from "./pool";

migrate()
  .then(async () => {
    console.log("migration complete");
    await closePool();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
