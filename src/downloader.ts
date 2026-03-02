import type { FileNode, FileTreeStructure } from "./interfaces/filetree";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const CDNS = [
    "http://static0.xesimg.com",
    "https://static0.xesimg.com",
    "http://livefile.xesimg.com",
    "https://livefile.xesimg.com",
    "https://livefile.xesv5.com",
];
let cdnIndex = 0;

const downloadOnce = async (data: FileNode, dir: string): Promise<boolean> => {
    try {
        await mkdir(dir, { recursive: true });

        const filePath = join(dir, data.name);

        if (data.type === "oss_file") {
            const md5ext = (data as FileNode).md5ext || (data as FileNode).assetId;
            if (md5ext) {
                const startIdx = cdnIndex;
                let tried = 0;
                while (tried < CDNS.length) {
                    const cdn = CDNS[cdnIndex % CDNS.length];
                    const url = `${cdn}/programme/python_assets/${md5ext}`;
                    try {
                        const res = await fetch(url, {
                            headers: {
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                            },
                        });
                        if (res.ok) {
                            const buf = new Uint8Array(await res.arrayBuffer());
                            await writeFile(filePath, buf);
                            return true;
                        }
                    } catch (e) {
                        // ignore and try next cdn
                    }

                    cdnIndex++;
                    tried++;
                    if (cdnIndex - startIdx >= CDNS.length) break;
                }
            }
        }

        // fallback: write provided value/originValue
        const content = (data as FileNode).value ?? (data as FileNode).originValue ?? "";
        if ((data as FileNode).dataFormat === "base64") {
            const buf = Buffer.from(String(content), "base64");
            await writeFile(filePath, buf);
        } else {
            await writeFile(filePath, String(content), "utf-8");
        }

        return true;
    } catch (e) {
        console.error("downloadOnce error:", e);
        return false;
    }
};

export const downloadAll = async (
    data: FileTreeStructure["treeAssets"],
    outRoot: string = process.cwd(),
): Promise<string> => {
    const dfs = async (nodes: FileTreeStructure["treeAssets"], currentPath: string) => {
        for (const node of nodes) {
            const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name;
            const targetDir = join(outRoot, currentPath || "");

            if (node.isDir) {
                const dirPath = join(outRoot, fullPath);
                await mkdir(dirPath, { recursive: true });
                if (node.children && node.children.length > 0) {
                    await dfs(node.children, fullPath);
                }
            } else {
                await downloadOnce(node as FileNode, targetDir);
            }
        }
    };

    await dfs(data, "");

    return outRoot;
};