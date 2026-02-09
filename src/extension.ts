import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

const MRU_KEY = "ghqStatusPicker.mru";

function uniqPreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}

async function runGhq(args: string[], out: vscode.OutputChannel): Promise<string> {
  out.appendLine(`$ ghq ${args.join(" ")}`);
  try {
    const { stdout } = await execFileAsync("ghq", args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const s = stdout.trim();
    out.appendLine(s ? s : "(no output)");
    return s;
  } catch (e: any) {
    const msg =
      e?.code === "ENOENT"
        ? "ghq が見つかりません。ghq をインストールして PATH に通してください。"
        : `ghq 実行に失敗しました: ${e?.message ?? String(e)}`;
    out.appendLine(`ERROR: ${msg}`);
    throw new Error(msg);
  }
}

type PickItem = vscode.QuickPickItem & { repoRel?: string; isHeader?: boolean };

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("GHQ Status Picker");
  context.subscriptions.push(out);

  const command = vscode.commands.registerCommand("ghqStatusPicker.open", async () => {
    try {
      const cfg = vscode.workspace.getConfiguration("ghqStatusPicker");
      const openInNewWindow = cfg.get<boolean>("openInNewWindow", true);
      const maxMRU = cfg.get<number>("maxMRU", 15);

      const root = await runGhq(["root"], out);
      const listRaw = await runGhq(["list"], out);

      const repos = listRaw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      if (repos.length === 0) {
        vscode.window.showInformationMessage("ghq list が空でした。");
        return;
      }

      const mru = context.globalState.get<string[]>(MRU_KEY, []).filter(Boolean);
      const mruInList = mru.filter((r) => repos.includes(r));
      const rest = repos.filter((r) => !mruInList.includes(r));

      const items: PickItem[] = [];
      if (mruInList.length > 0) {
        items.push({ label: "Recently opened", kind: vscode.QuickPickItemKind.Separator, isHeader: true });
        for (const r of mruInList) items.push({ label: r, repoRel: r });
      }
      items.push({ label: "All repositories", kind: vscode.QuickPickItemKind.Separator, isHeader: true });
      for (const r of rest) items.push({ label: r, repoRel: r });

      const picked = await vscode.window.showQuickPick(items, {
        title: "GHQ repositories",
        placeHolder: "開くリポジトリを選択",
      });

      if (!picked || !picked.repoRel) return;

      const repoPath = path.join(root, picked.repoRel);

      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(repoPath),
        openInNewWindow
      );

      const nextMRU = uniqPreserveOrder([picked.repoRel, ...mru]).slice(0, Math.max(0, maxMRU));
      await context.globalState.update(MRU_KEY, nextMRU);
    } catch (err: any) {
      vscode.window.showErrorMessage(err?.message ?? String(err));
    }
  });
  context.subscriptions.push(command);

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  item.text = "$(repo) GHQ";
  item.tooltip = "GHQ: Open Repository";
  item.command = "ghqStatusPicker.open";
  item.show();
  context.subscriptions.push(item);
}

export function deactivate() {}
