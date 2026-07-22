import { createServer } from "node:http";

const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("DevHub test server");
});

server.listen(43124, "127.0.0.1", () => {
  console.log("ready at http://localhost:43124/");
});
