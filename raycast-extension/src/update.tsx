import { closeMainWindow, showHUD } from "@raycast/api";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { prefs } from "./lib";

export default async function Command() {
  await closeMainWindow();
  const script = path.join(prefs().dir, "raycast", "update-mailroom.sh");
  if (!fs.existsSync(script)) {
    await showHUD(`Can't find ${script}. Check the Mailroom Folder preference.`);
    return;
  }
  const out = await new Promise<string>((resolve) => {
    execFile("/bin/bash", [script], { env: { ...process.env, MAILROOM_DIR: prefs().dir }, timeout: 60_000 }, (err, stdout, stderr) =>
      resolve((stdout || stderr || (err ? err.message : "")).trim().split("\n").pop() || "Done"),
    );
  });
  // The running server restarts itself on new code; open windows reload within a few seconds.
  await showHUD(out);
}
