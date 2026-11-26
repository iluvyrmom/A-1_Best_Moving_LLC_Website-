const { createProxyHandler } = require("../proxy-current-deploy");

exports.handler = createProxyHandler("speech-text");
