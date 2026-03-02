import { CORS_HEADERS } from './port_helper';

export class RouteHandler {
	static readonly RESPONSE_INIT: ResponseInit = {
		status: 200,
		statusText: 'OK',
		headers: {
			'Content-Type': 'application/json',
			...CORS_HEADERS,
		},
	};

	static getRoutes() {
		return {
			'/package/err': this.createJsonResponse({ data: [] }),
			'/package/mirrors': this.createJsonResponse({
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
			}),
			'/version': this.createJsonResponse({ data: { version: '2.13' } }),
			'/package/state': new Response(null, this.RESPONSE_INIT),
			'/ping': this.createJsonResponse({ data: { auto: false } }),
		};
	}

	private static createJsonResponse(data: any) {
		return Response.json(data, this.RESPONSE_INIT);
	}
}
