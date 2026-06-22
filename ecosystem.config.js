module.exports = {
  apps: [
    {
      name: "fenevision-request",
      script: "server.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
