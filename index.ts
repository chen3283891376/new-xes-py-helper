import { check, get_port } from './src/port_helper';
import { PythonProcessManager } from './src/python';
import { RouteHandler } from './src/route_handler';
import { createWsServer } from './src/websocket';

let port: number = 55820;

if (await check()) {
	port = get_port();
	console.log('端口检查通过', port, port + 1);
} else {
	console.log('端口检查失败');
	process.exit(1);
}

const httpServer = Bun.serve({
	port: port,
	hostname: '127.0.0.1',
	routes: RouteHandler.getRoutes(),
});

const pythonProcess = new PythonProcessManager();

const { server: wsServer } = createWsServer(port + 1, pythonProcess);
