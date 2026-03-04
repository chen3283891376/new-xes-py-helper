import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { downloadAll, stringToBase64, CORS_HEADERS } from '../utils';
import { analyzePythonError, PythonProcessManager } from '../python';
import type { ServerWebSocket } from 'bun';
import { platform } from 'os';
import nanolog from '@turbowarp/nanolog';

interface WsServerHandle {
	server: ReturnType<typeof Bun.serve>;
}

export function createWsServer(
	port: number,
	pythonProcess: PythonProcessManager,
): WsServerHandle {
	const logger = nanolog('WSS')

	let input = '';
	let projectPath = '';
	let installingMissing = false;
	const isWin = platform() === 'win32';

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
						Type: 'compileFail',
						Info: '运行终止',
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
			if (data.assets.length > 0) {
				await downloadAll(data.assets, projectPath);
			}
			await writeFile(
				join(projectPath, 'main.py'),
				data.xml || '',
				'utf-8',
			);
			logger.info('资源下载成功', projectPath)
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
				safeSend(
					ws,
					`1${stringToBase64(
						!isWin ? chunk.replace(/\n/g, '\r\n') : chunk,
					)}`,
				);
			});
			pythonProcess.onStderr(async (chunk) => {
				const missingModule = analyzePythonError(chunk).missingModule;
				safeSend(
					ws,
					`1${stringToBase64(
						!isWin ? chunk.replace(/\n/g, '\r\n') : chunk,
					)}`,
				);
				if (missingModule) {
					safeSend(
						ws,
						`1${stringToBase64('[stderr] 开始自动安装缺失模块...\n')}`,
					);
					installingMissing = true;
					const result =
						await pythonProcess.installPackage(missingModule);
					safeSend(ws, `1${stringToBase64(result.output)}`);
					safeSend(
						ws,
						`1${stringToBase64('[stderr] 自动安装完成，请重新运行程序...\n')}`,
					);
					installingMissing = false;
					ws.close();
				}
			});
			pythonProcess.onExit(() => {
				if (!installingMissing) {
					try {
						safeSend(
							ws,
							'7eyJUeXBlIjogInNpZ25hbCIsICJJbmZvIjogIntcIm5ld1wiOiBbXSwgXCJkZWxcIjogW10sIFwibW9kXCI6IFtdLCBcImRpcl9kZWxcIjogW10sIFwiZGlyX25ld1wiOiBbXSwgXCJ0eXBlXCI6IFwiY2hhbmdlZFwifSJ9',
						);
						safeSend(
							ws,
							'7eyJUeXBlIjogInJ1bkluZm8iLCAiSW5mbyI6ICJcclxuXHJcblx1NGVlM1x1NzgwMVx1OGZkMFx1ODg0Y1x1N2VkM1x1Njc1ZiJ9',
						);
						ws.close();
					} catch {
						// ignore
					}
				}
			});

			await pythonProcess.startProcess(
				join(projectPath, 'main.py'),
				projectPath,
			);
		}
	};

	const handleType1 = (ws: ServerWebSocket<undefined>, raw: string) => {
		let text = raw;
		if (text === '\r') text = isWin ? '\r\n' : '\n';
		switch (text) {
			case '\x7f':
				if (input.length > 0) {
					input = input.slice(0, -1);
					ws.send(`1${stringToBase64('\b \b')}`);
				}
				break;
			case '\r\n':
			case '\n':
				pythonProcess.sendInput(input);
				input = '';
				ws.send(
					`1${stringToBase64((text as string).replace(/\n/g, '\r\n'))}`,
				);
				break;
			case '\x03':
				ws.send(`1${stringToBase64('^C')}`);
				pythonProcess.sendCtrlC();
				break;
			default:
				ws.send(`1${stringToBase64(text as string)}`);
		}
	};

	const wsServer = Bun.serve({
		port,
		hostname: '127.0.0.1',
		websocket: {
			open() {
				logger.debug('ws连接成功')
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
			close() {
				logger.debug('ws连接关闭')
			},
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
					data: {
						clientId: Date.now(),
						src: '/',
						res,
					} as unknown as undefined,
				});
				return;
			}
			return new Response(null, { status: 404, headers: CORS_HEADERS });
		},
	});

	return { server: wsServer };
}
