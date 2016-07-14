var utils = require('../libs/utils');
var errFactory = require('../libs/err_factory');

var users = exports.users = utils.readConfig('users') || [];

exports.checkAdminPermission = function (user, next) {
	var username = user['username'];
	user = exports.getUser(username);
	if (user && user['is_admin'] && user['enabled']) {
		next();
	} else {
		next(errFactory.unauthorized());
	}
};

exports.getUser = function (username) {
	return users.filter(function (user) {
		return user['username'] === username;
	})[0];
};

exports.addUser = function (user, next) {
	exports.deleteUser(user['username'], function () {
		users.push(user);
		utils.writeConfig('users', users, next);
	});
};

exports.updateUser = function (username, data, next) {
	utils.forEach(users, function (user, i) {
		if (user['username'] === username) {
			users[i] = data;
			return false;
		}
	});
	utils.writeConfig('users', users, next);
};

exports.deleteUser = function (username, next) {
	utils.forEach(users, function (user, i) {
		if (user['username'] === username) {
			users.splice(i, 1);
			return false;
		}
	});
	utils.writeConfig('users', users, next);
};
