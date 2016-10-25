#!/usr/bin/env node

var program = require('commander');
var utils = require('../libs/utils');
var pkg = require('../package.json');

program
	.version(pkg.version, '-v, --version');

program
	.command('start [port=8080]')
	.description('start cd-cluster master')
	.action(function (port) {
		var env = process.env;
		env['CD_CLUSTER_PORT'] = port || 8080;
		utils.startInstance('master', env);
	});

program
	.command('stop')
	.description('stop cd-cluster master')
	.action(function () {
		utils.stopInstance('master');
	});

program
	.command('reload')
	.description('reload cd-cluster master')
	.action(function () {
		utils.reloadInstance('master');
	});

if (!process.argv.slice(2).length) {
	program.help();
}

program.parse(process.argv);
