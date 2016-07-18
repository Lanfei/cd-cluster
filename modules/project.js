var path = require('path');
var http = require('http');
var fs = require('fs-extra');
var async = require('async');
var archiver = require('archiver');
var querystring = require('querystring');
var spawn = require('child_process').spawn;
var utils = require('../libs/utils');
var errFactory = require('../libs/err_factory');
var userModule = require('../modules/user');
var historyModule = require('../modules/history');

var tasks = {};

var projects = utils.readConfig('projects') || [];

exports.getProjects = function () {
	return projects;
};

exports.getProject = function (name) {
	return projects.filter(function (project) {
		return project['name'] === name;
	})[0];
};

exports.addProject = function (project, next) {
	projects.push(project);
	utils.writeConfig('projects', projects, next);
};

exports.updateProject = function (name, data, next) {
	var shouldCleanWorkspace = false;
	utils.forEach(projects, function (project, i) {
		if (project['name'] === name) {
			projects[i] = data;
			shouldCleanWorkspace =
				data['repo_type'] !== project['repo_type'] ||
				data['repo_url'] !== project['repo_url'] ||
				data['repo_branch'] !== project['repo_branch'];
			return false;
		}
	});
	async.parallel([
		function (next) {
			utils.writeConfig('projects', projects, next);
		},
		function (next) {
			if (shouldCleanWorkspace) {
				exports.cleanWorkspace(name, next);
			} else {
				next();
			}
		},
		function (next) {
			if (shouldCleanWorkspace) {
				exports.abortProject(name, next);
			} else {
				next();
			}
		}
	], function (err) {
		next && next(err);
	});
};

exports.deleteProject = function (name, next) {
	utils.forEach(projects, function (project, i) {
		if (project['name'] === name) {
			projects.splice(i, 1);
			return false;
		}
	});
	async.parallel([
		function (next) {
			utils.writeConfig('projects', projects, next);
		},
		function (next) {
			exports.cleanWorkspace(name, next);
		},
		function (next) {
			historyModule.cleanHistories(name, next);
		}
	], function (err) {
		next(err);
	});
};

exports.buildProject = function (name, operator, next) {
	var project = exports.getProject(name);
	var step;
	var history;
	var historyId;
	if (!project) {
		next();
		return;
	}
	async.waterfall([
		function (next) {
			historyModule.addHistory(name, operator, next);
		},
		function (data, next) {
			history = data;
			historyId = history['id'];
			historyModule.setHistorySize(name, +project['history_size'] || 1, next);
		},
		function (next) {
			history['status'] = historyModule.STATUS_UPDATING;
			historyModule.updateHistory(name, historyId, history, next);
		},
		function (next) {
			exports.ensureWorkspace(name, next);
		},
		function (made, next) {
			var command;
			var repoType = project['repo_type'];
			var repoUrl = project['repo_url'];
			var repoBranch = project['repo_branch'] || 'master';
			if (repoType === 'git') {
				if (made) {
					command = 'git clone --progress --depth 1 -b ' + repoBranch + ' ' + repoUrl + ' ./';
				} else {
					command = 'git pull';
				}
			} else if (repoType === 'svn') {
				if (made) {
					command = 'svn co ' + repoUrl + ' ./';
				} else {
					command = 'svn up';
				}
			}
			step = 'checkout';
			runCommand(name, historyId, step, command, function (err) {
				if (err) {
					exports.cleanWorkspace(name);
				}
				next(err);
			});
		},
		function (next) {
			step = 'build';
			history['status'] = historyModule.STATUS_BUILDING;
			historyModule.updateHistory(name, historyId, history, next);
		},
		function (next) {
			runCommand(name, historyId, step, project['build_scripts'], next);
		},
		function (next) {
			step = 'test';
			history['status'] = historyModule.STATUS_TESTING;
			historyModule.updateHistory(name, historyId, history, next);
		},
		function (next) {
			runCommand(name, historyId, step, project['test_scripts'], next);
		},
		function (next) {
			step = 'pack';
			history['status'] = historyModule.STATUS_PACKING;
			historyModule.updateHistory(name, historyId, history, next);
		},
		function (next) {
			historyModule.writeOutput(name, historyId, step, 'Creating zip file...\n', next);
		},
		function (next) {
			exports.packProject(name, historyId, project['ignores'], next);
		},
		function (next) {
			history['build_url'] = historyModule.getBuildUrl(name, historyId);
			historyModule.updateHistory(name, historyId, history, next);
		},
		function (next) {
			historyModule.writeOutput(name, historyId, step, '\nDone.', next);
		},
		function (next) {
			step = 'deploy';
			history['status'] = historyModule.STATUS_DEPLOYING;
			historyModule.updateHistory(name, historyId, history, next);
		},
		function (next) {
			exports.deployProject(name, historyId, next);
		},
		function (result, next) {
			historyModule.writeOutput(name, historyId, step, result, next);
		}
	], function (err) {
		var startTime = history['start_time'];
		history['duration'] = Date.now() - startTime;
		if (err) {
			history['status'] = historyModule.STATUS_FAILED;
			historyModule.writeOutput(name, historyId, step, (err.desc || err.message) + '\n' + '\u001b[31mFailed.\u001b[39m');
		} else {
			history['status'] = historyModule.STATUS_SUCCESS;
		}
		historyModule.updateHistory(name, historyId, history, next);
	});
};

exports.abortProject = function (name, next) {
	var task = tasks[name];
	var project = exports.getProject(name);
	if (task && project) {
		var historyId = task['id'];
		var process = task['process'];
		var archive = task['archive'];
		var request = task['request'];
		var history = historyModule.getHistory(name, historyId);

		function updateHistory() {
			history['status'] = historyModule.STATUS_ABORTED;
			historyModule.updateHistory(name, historyId, history, next);
		}

		if (request) {
			request.abort();
			updateHistory();
		} else if (archive) {
			archive.abort();
			updateHistory();
		} else if (process) {
			if (process.killed || process.exitCode !== null) {
				updateHistory();
			} else {
				process.kill();
				process.on('exit', function () {
					updateHistory();
				});
			}
		} else {
			updateHistory();
		}
		delete tasks[name];
	} else {
		next();
	}
};

exports.packProject = function (name, historyId, ignores, next) {
	var zipPath = historyModule.getBuildPath(name, historyId);
	var workspace = exports.getWorkspace(name);
	var project = exports.getProject(name);
	var task = tasks[name];
	if (!project) {
		next();
		return;
	}
	async.waterfall([
		function (next) {
			fs.ensureDir(path.dirname(zipPath), next);
		},
		function (made, next) {
			fs.remove(zipPath, next);
		},
		function (next) {
			var archive = archiver('zip', {});
			var output = fs.createWriteStream(zipPath);
			if (ignores) {
				ignores = ignores.split('\n').map(function (item) {
					if (item.slice(-1) === '/') {
						item += '**';
					}
					return item;
				});
			}
			if (!task) {
				task = tasks[name] = {
					id: historyId,
					archive: archive
				};
			}
			try {
				archive.bulk([
					{
						src: '**/*',
						expand: true,
						ignore: ignores,
						cwd: workspace
					}
				]);
				archive.pipe(output);
				archive.finalize();
				output.on('close', next);
				archive.on('error', next);
			} catch (e) {
				next(e);
				output.end();
			}
		}
	], function (err) {
		if (task && task['archive']) {
			delete tasks[name];
		}
		next(err);
	});
};

exports.deployProject = function (name, historyId, next) {
	var project = exports.getProject(name);
	if (!project) {
		next();
		return;
	}
	var task = tasks[name];
	var nodes = project['deploy_nodes'];
	var buildPath = historyModule.getBuildPath(name, historyId);
	var stream = fs.createReadStream(buildPath);
	if (!task) {
		task = tasks[name] = {
			historyId: historyId,
			requests: []
		}
	}
	async.map(nodes, function (node, next) {
		var data = {
			name: name,
			cwd: node['cwd'],
			host: node['host'],
			token: node['token'],
			history_id: historyId,
			pre_deploy_scripts: project['pre_deploy_scripts'],
			post_deploy_scripts: project['post_deploy_scripts']
		};
		var finished = false;
		var qs = querystring.stringify(data);
		var host = node['host'];
		var port = node['port'];
		var req = http.request({
			host: host,
			port: port,
			method: 'post',
			path: '/deploy?' + qs
		}, function (res) {
			utils.receiveJSON(res, function (err, json) {
				if (!finished) {
					finished = true;
					next(err, json);
				}
			});
		});
		req.on('error', function (err) {
			if (!finished) {
				finished = true;
				next(err);
			}
		});
		stream.pipe(req);
		if (task) {
			task['requests'].push(req);
		}
	}, function (err, results) {
		if (task && task['requests']) {
			delete task[name];
		}
		if (err) {
			next(err);
		} else {
			resolveNodeResults(results, nodes, next);
		}
	});
};

exports.executeScript = function (name, scriptId, next) {
	var project = exports.getProject(name);
	if (!project) {
		next();
		return;
	}
	var nodes = project['deploy_nodes'];
	var operationScript = project['operation_scripts'] || [];
	var script = operationScript[scriptId];
	async.map(nodes, function (node, next) {
		var data = {
			name: name,
			cwd: node['cwd'],
			host: node['host'],
			token: node['token'],
			script_id: scriptId,
			command: script['command']
		};
		var finished = false;
		var qs = querystring.stringify(data);
		var host = node['host'];
		var port = node['port'];
		var req = http.request({
			host: host,
			port: port,
			method: 'post',
			path: '/execute?' + qs
		}, function (res) {
			utils.receiveJSON(res, function (err, json) {
				if (!finished) {
					finished = true;
					next(err, json);
				}
			});
		});
		req.on('error', function (err) {
			if (!finished) {
				finished = true;
				next(err);
			}
		});
		req.end();
	}, function (err, results) {
		if (err) {
			next(err);
		} else {
			resolveNodeResults(results, nodes, next);
		}
	});
};

exports.ensureWorkspace = function (name, next) {
	fs.ensureDir(exports.getWorkspace(name), next);
};

exports.cleanWorkspace = function (name, next) {
	fs.remove(exports.getWorkspace(name), next);
};

exports.getWorkspace = function (name) {
	var configDir = utils.getConfigDir();
	return configDir + '/workspace/' + name;
};

exports.getBuildEnv = function (name, historyId) {
	return utils.extend({}, process.env, {
		PROJECT_NAME: name,
		BUILD_ID: historyId
	});
};

exports.checkPermission = function (user, project, next) {
	var username = user['username'];
	var managers = project['managers'] || [];
	user = userModule.getUser(username);
	if (user && user['is_admin'] && user['enabled'] || managers.indexOf(username) >= 0) {
		next();
	} else {
		next(errFactory.unauthorized());
	}
};

function resolveNodeResults(results, nodes, next) {
	var err;
	var output = '';
	var failed = false;
	if (results) {
		output = results.map(function (res, i) {
			var msg = '';
			var node = nodes[i];
			var host = node['host'];
			if (res && res['data']) {
				msg += res['data'];
			}
			if (res && res['error']) {
				failed = true;
				msg += '\n' + res['error_desc'] || res['error'];
			}
			return '\u001b[1m' + host + ':\u001b[22m\n' + msg;
		}).join('\n\n');
	}
	if (failed) {
		err = errFactory.runtimeError(output);
	}
	next(err, output);
}

function runCommand(name, historyId, step, command, next) {
	if (!command) {
		next();
		return;
	}
	var configDir = utils.getConfigDir();
	var env = exports.getBuildEnv(name, historyId);
	var commandFile = configDir + '/tmp/' + name + '-' + historyId + '-' + step;
	async.waterfall([
		function (next) {
			historyModule.writeOutput(name, historyId, step, command + '\n', next);
		},
		function (next) {
			fs.outputFile(commandFile, command, next);
		},
		function (next) {
			var finished = false;
			var workspace = exports.getWorkspace(name);
			var p = spawn('sh', [commandFile], {
				cwd: workspace,
				env: env
			});
			p.stdout.on('data', function (data) {
				historyModule.writeOutput(name, historyId, step, data);
			});
			p.stderr.on('data', function (data) {
				historyModule.writeOutput(name, historyId, step, data);
			});
			p.on('close', function (code) {
				if (!finished) {
					finished = true;
					if (code) {
						next(errFactory.runtimeError('Process exited with code ' + code));
					} else {
						next();
					}
				}
			});
			p.on('error', function (err) {
				if (!finished) {
					finished = true;
					next(err);
				}
			});
			tasks[name] = {
				id: historyId,
				process: p
			};
		}
	], function (err) {
		fs.remove(commandFile);
		if (tasks[name]) {
			delete tasks[name];
			next(err);
		}
	});
}
