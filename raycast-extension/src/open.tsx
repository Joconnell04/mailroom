import { closeMainWindow, showHUD } from "@raycast/api";
import { ensureServer, openInMailroom } from "./lib";

export default async function Command() {
  await closeMainWindow();
  try {
    await ensureServer();
    await openInMailroom("#/now");
  } catch (e) {
    await showHUD(`Mailroom: ${(e as Error).message}`);
  }
}
