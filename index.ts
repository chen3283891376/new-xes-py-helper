import { join } from 'path';
import { downloadAll } from './src/downloader';
import { check, get_port } from './src/port_helper';
import { PythonProcessManager } from './src/python';
import { stringToBase64 } from './src/utils';
import { mkdir, writeFile } from 'fs/promises';

let port: number = 55820;
const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

if (await check()) {
	port = get_port();
	console.log('端口检查通过', port, port+1);
} else {
	console.log('端口检查失败');
	process.exit(1);
}

const responseInitForRoutes: ResponseInit = {
	status: 200,
	statusText: 'OK',
	headers: {
		'Content-Type': 'application/json',
		...corsHeaders,
	},
};
const routes = {
	'/package/err': Response.json(
		{
			data: [],
		},
		responseInitForRoutes,
	),
	'/package/mirrors': Response.json(
		{
			data: {
				current_index: 0,
				mirrors: [
					{
						mirror: 'https://mirrors.aliyun.com/pypi/simple/',
						name: '默认',
					},
					{
						mirror: 'https://pypi.tuna.tsinghua.edu.cn/simple',
						name: '线路1',
					},
					{
						mirror: 'https://pypi.douban.com/simple/',
						name: '线路2',
					},
					{
						mirror: 'https://pypi.org/simple',
						name: 'Python 原版',
					},
				],
			},
		},
		responseInitForRoutes,
	),
	'/version': Response.json(
		{
			data: {
				version: '2.13',
			},
		},
		responseInitForRoutes,
	),
	'/package/state': new Response(null, responseInitForRoutes),
	'/ping': Response.json(
		{
			data: {
				auto: false,
			},
		},
		responseInitForRoutes,
	),
};

const httpServer = Bun.serve({
	port: port,
	hostname: '127.0.0.1',
	routes: routes,
});

let input = '';
let project_path = '';
const pythonProcess = new PythonProcessManager();

const wsServer = Bun.serve({
    port: port + 1,
    hostname: '127.0.0.1',
	websocket: {
		open(ws) {
			console.log('open');
			input = '';
		},
		async message(ws, message) {
			const type = message[0];
			switch (type) {
				case '7': {
					const data = JSON.parse(message.slice(1) as string)
					if (data.type === 'conn' && data.handle === 'close') {
						ws.send(`7${JSON.stringify({
							type: "compileFail",
							info: '链接终止'
						})}`)
						ws.close();
						return;
					}
					if (data.type === 'run') {
						ws.send('7eyJUeXBlIjogImFzc2V0cyIsICJJbmZvIjogInN0YXJ0In0=');
						project_path = join(process.cwd(), 'temp', String(Date.now())); // 下载资源到临时目录
						await mkdir(project_path, { recursive: true });
						if ((data.assets as any[]).length > 0) {
							await downloadAll(data.assets, project_path);
						}
						await writeFile(join(project_path, 'main.py'), data.xml || '', 'utf-8');
						console.log('项目资源下载完成', project_path);
						ws.send(`7${stringToBase64(JSON.stringify({
							Type: "assets",
							Info: "end"
						}))}`);
					}
					if (data.xml) {
						const safeSend = (payload: string) => {
							try {
								ws.send(payload);
							} catch (_e) {
								// 可能已经关闭连接，无法发送消息，忽略错误
							}
						};

						pythonProcess.onStdout(chunk => {
							safeSend(`1${stringToBase64(chunk)}`);
						});
						pythonProcess.onStderr(chunk => {
							safeSend(`1${stringToBase64(chunk)}`);
						});

						pythonProcess.onExit(() => {
							safeSend('7eyJUeXBlIjogInNpZ25hbCIsICJJbmZvIjogIntcIm5ld1wiOiBbXSwgXCJkZWxcIjogW10sIFwibW9kXCI6IFtdLCBcImRpcl9kZWxcIjogW10sIFwiZGlyX25ld1wiOiBbXSwgXCJ0eXBlXCI6IFwiY2hhbmdlZFwifSJ9');
							safeSend('7eyJUeXBlIjogInJ1bkluZm8iLCAiSW5mbyI6ICJcclxuXHJcblx1NGVlM1x1NzgwMVx1OGZkMFx1ODg0Y1x1N2VkM1x1Njc1ZiJ9');
							try { ws.close(); } catch {};
						});

						await pythonProcess.startProcess(join(project_path, 'main.py'), project_path);
						// output now arrives via callbacks, exit is handled above
					}
					break;
				}
				case '1': {
					let text = message.slice(1);
					if (text === '\r') text = '\r\n';
					input += text;
					if (text === '\r\n') {
						pythonProcess.sendInput(input);
						input = '';
					}
					ws.send(`1${stringToBase64(text as string)}`);
					break;
				}
			}
		},
		close(ws, code, reason) {
			console.warn('close');
		},
		drain(ws) {},
	},
	fetch(req, res) {
		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders });
		}
		if (req.headers.get('upgrade') === 'websocket') {
			res.upgrade(req, {
				data: { clientId: Date.now(), src: '/', res } as any,
			});
			return;
		}
		return new Response(null, { status: 404, headers: corsHeaders });
	},
});