const { createProxyHandler } = require("../proxy-current-deploy");

exports.handler = createProxyHandler("submit-lead");
