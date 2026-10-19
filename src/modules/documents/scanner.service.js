import net from "node:net";
import { RuleError } from "../../shared/rules.js";
export function clamScan(buffer, config) {
  return new Promise((resolve, reject) => {
    if (!config.clamHost)
      return reject(new RuleError("ClamAV is not configured", 503));
    const socket = net.createConnection({
      host: config.clamHost,
      port: config.clamPort,
    });
    let text = "",
      done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    socket.setTimeout(10000, () =>
      finish(new RuleError("Scanner timed out", 503)),
    );
    socket.on("error", () => finish(new RuleError("Scanner unavailable", 503)));
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      let offset = 0;
      const pump = () => {
        while (offset < buffer.length) {
          const size = Math.min(65536, buffer.length - offset),
            header = Buffer.alloc(4);
          header.writeUInt32BE(size);
          socket.write(header);
          const chunk = buffer.subarray(offset, offset + size);
          offset += size;
          if (!socket.write(chunk)) {
            socket.once("drain", pump);
            return;
          }
        }
        socket.write(Buffer.alloc(4));
      };
      pump();
    });
    socket.on("data", (data) => {
      text += data.toString();
      if (text.length > 4096)
        return finish(new RuleError("Invalid scanner response", 503));
      if (text.includes("\0") || text.includes("\n")) {
        if (/: OK(?:\0|\n)/.test(text))
          finish(null, { clean: true, engine: "ClamAV" });
        else if (/ FOUND(?:\0|\n)/.test(text))
          finish(null, { clean: false, engine: "ClamAV" });
        else finish(new RuleError("Scanner rejected stream", 503));
      }
    });
    socket.on("end", () => {
      if (!done) finish(new RuleError("Incomplete scanner response", 503));
    });
  });
}
export const scanFile = (buffer, config) =>
  config.mode === "test" && config.scanner
    ? config.scanner(buffer)
    : clamScan(buffer, config);
