import { select } from '@inquirer/prompts';
import { check, get_port } from './src/port_helper';
import { getLocalPythonInterpreters, PythonProcessManager } from './src/python';
import { RouteHandler } from './src/route_handler';
import { createWsServer } from './src/websocket';

(async () => {
	const pythonInterpreters = await getLocalPythonInterpreters();
	if (pythonInterpreters.length === 0) {
		console.log('未找到可用的Python环境');
		process.exit(1);
	}
	const currentPython = await select({
		message: '请选择Python环境',
		choices: pythonInterpreters,
	});

	// 检查端口是否可用
	let port: number = 55820;

	if (await check()) {
		port = get_port();
		console.log('端口检查通过', port, port + 1);
	} else {
		console.log('端口检查失败');
		process.exit(1);
	}

	// 开启HTTP服务
	const httpServer = Bun.serve({
		port: port,
		hostname: '127.0.0.1',
		routes: RouteHandler.getRoutes(),
	});

	// 开启Websocket服务
	const pythonProcess = new PythonProcessManager(currentPython);

	const { server: wsServer } = createWsServer(port + 1, pythonProcess);
})();
