// Dependency injection keeps the request lifecycle independently testable.
export function createVercelHandler({ initialize, waitUntil, drainEmails }) {
  let ready;
  return async function handler(req, res) {
    if (!ready)
      ready = initialize().catch((error) => {
        ready = undefined;
        throw error;
      });
    const { app, config } = await ready;
    const pathname = new URL(
      req.url,
      "https://backend.invalid",
    ).pathname.replace(/\/$/, "");
    if (
      req.method === "POST" &&
      [
        "/api/auth/register",
        "/api/auth/resend-verification",
        "/api/auth/forgot-password",
        "/api/users",
      ].includes(pathname)
    ) {
      const completed = new Promise((resolve) => {
        res.once("finish", resolve);
        res.once("close", resolve);
      });
      waitUntil(
        completed
          .then(async () => {
            if (
              res.writableFinished &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            )
              await drainEmails(config);
          })
          .catch(() => {
            console.error(
              JSON.stringify({
                level: "error",
                message: "Vercel email delivery task failed",
              }),
            );
          }),
      );
    }
    return app(req, res);
  };
}
