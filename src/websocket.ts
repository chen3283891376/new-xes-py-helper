import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { downloadAll } from './downloader';
import { stringToBase64 } from './utils';
import { PythonProcessManager } from './python';
import { CORS_HEADERS } from './port_helper';
import type { ServerWebSocket } from 'bun';

interface WsServerHandle {
	server: ReturnType<typeof Bun.serve>;
}

export function createWsServer(
	port: number,
	pythonProcess: PythonProcessManager,
): WsServerHandle {
	let input = '';
	let projectPath = '';

	const safeSend = (ws: ServerWebSocket<undefined>, payload: string) => {
		try {
			ws.send(payload);
		} catch {
			// 连接可能已经关闭，忽略
		}
	};

	const handleType7 = async (ws: ServerWebSocket<undefined>, raw: string) => {
		const data = JSON.parse(raw as string);

		if (data.type === 'conn' && data.handle === 'close') {
			ws.send(
				`7${stringToBase64(
					JSON.stringify({
						type: 'compileFail',
						info: '链接终止',
					}),
				)}`,
			);
			ws.close();
			return;
		}

		if (data.type === 'run') {
			// 开启新的运行，准备临时项目文件夹
			ws.send('7eyJUeXBlIjogImFzc2V0cyIsICJJbmZvIjogInN0YXJ0In0=');
			projectPath = join(process.cwd(), 'temp', String(Date.now()));
			await mkdir(projectPath, { recursive: true });
			if ((data.assets as any[]).length > 0) {
				await downloadAll(data.assets, projectPath);
			}
			await writeFile(
				join(projectPath, 'main.py'),
				data.xml || '',
				'utf-8',
			);
			console.log('项目资源下载完成', projectPath);
			ws.send(
				`7${stringToBase64(
					JSON.stringify({
						Type: 'assets',
						Info: 'end',
					}),
				)}`,
			);
		}

		if (data.xml) {
			// data.xml 为Python程序的主代码
			pythonProcess.onStdout((chunk) => {
				safeSend(ws, `1${stringToBase64(chunk)}`);
			});
			pythonProcess.onStderr((chunk) => {
				safeSend(ws, `1${stringToBase64(chunk)}`);
			});
			pythonProcess.onExit(() => {
				safeSend(
					ws,
					'7eyJUeXBlIjogInNpZ25hbCIsICJJbmZvIjogIntcIm5ld1wiOiBbXSwgXCJkZWxcIjogW10sIFwibW9kXCI6IFtdLCBcImRpcl9kZWxcIjogW10sIFwiZGlyX25ld1wiOiBbXSwgXCJ0eXBlXCI6IFwiY2hhbmdlZFwifSJ9',
				);
				safeSend(
					ws,
					'7eyJUeXBlIjogInJ1bkluZm8iLCAiSW5mbyI6ICJcclxuXHJcblx1NGVlM1x1NzgwMVx1OGZkMFx1ODg0Y1x1N2VkM1x1Njc1ZiJ9',
				);
				try {
					ws.close();
				} catch {}
			});

			await pythonProcess.startProcess(
				join(projectPath, 'main.py'),
				projectPath,
			);
		}
	};

	const handleType1 = (ws: ServerWebSocket<undefined>, raw: string) => {
		let text = raw;
		if (text === '\r') text = '\r\n';
		if (text === '\x7F') {
			if (input.length > 0) {
				input = input.slice(0, -1);
				ws.send(`1${stringToBase64('\b \b')}`);
			}
			return;
		}
		input += text;
		if (text === '\r\n') {
			pythonProcess.sendInput(input);
			input = '';
		}
		if (text === '\x03') {
			pythonProcess.killProcess();
			ws.close();
		}
		ws.send(`1${stringToBase64(text as string)}`);
	};

	const wsServer = Bun.serve({
		port,
		hostname: '127.0.0.1',
		websocket: {
			open(ws) {
				console.log('open');
				input = '';
			},
			async message(ws, message) {
				const type = message[0];
				switch (type) {
					case '7':
						await handleType7(ws, message.slice(1) as string);
						break;
					case '1':
						handleType1(ws, message.slice(1) as string);
						break;
				}
			},
			close(ws, code, reason) {
				console.warn('close');
			},
			drain(ws) {},
		},
		fetch(req, res) {
			if (req.method === 'OPTIONS') {
				return new Response(null, {
					status: 204,
					headers: CORS_HEADERS,
				});
			}
			if (req.headers.get('upgrade') === 'websocket') {
				res.upgrade(req, {
					data: { clientId: Date.now(), src: '/', res } as any,
				});
				return;
			}
			return new Response(null, { status: 404, headers: CORS_HEADERS });
		},
	});

	return { server: wsServer };
}
