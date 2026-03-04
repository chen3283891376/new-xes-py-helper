import { select } from '@inquirer/prompts';
import { checkPorts, getPort } from './src/utils';
import { getLocalPythonInterpreters, PythonProcessManager } from './src/python';
import { createWsServer, HttpRouteHandler } from './src/servers';
import nanolog from '@turbowarp/nanolog';

(async () => {
	const logger = nanolog('Main');

	const pythonInterpreters = await getLocalPythonInterpreters();
	if (pythonInterpreters.length === 0) {
		logger.error('未找到可用的Python环境');
		process.exit(1);
	}
	const currentPython = await select({
		message: '请选择Python环境',
		choices: pythonInterpreters,
	});

	// 检查端口是否可用
	let port: number = 55820;

	if (await checkPorts()) {
		port = getPort();
		logger.info('端口检查通过');
		logger.info('HTTP 端口：', port);
		logger.info('Websocket 端口：', port + 1);
	} else {
		logger.error('端口检查失败');
		process.exit(1);
	}

	// 开启HTTP服务
	Bun.serve({
		port: port,
		hostname: '127.0.0.1',
		routes: HttpRouteHandler.getRoutes(),
	});

	// 开启Websocket服务
	const pythonProcess = new PythonProcessManager(currentPython);

	createWsServer(port + 1, pythonProcess);
})();
