<!doctype html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<title>CD Cluster</title>
	<link rel="stylesheet" href="/css/style.css">
</head>
<body>
<%- include('header') %>
<div id="main">
	<div class="toolbar">
		<button @click="back" v-text="i18n('Back')"></button>
	</div>
	<h3 class="sub-title" v-text="i18n('Project Info')"></h3>
	<div class="table-wrapper">
		<table>
			<thead>
			<tr>
				<th v-text="i18n('Name')" width="20%"></th>
				<th v-text="project['name']" align="left"></th>
			</tr>
			</thead>
			<tbody>
			<tr>
				<td v-text="i18n('Repository Type')"></td>
				<td align="left" v-text="project['repo_type'] | capitalize"></td>
			</tr>
			<tr v-if="project['repo_type'] !== 'none'">
				<td v-text="i18n('Repository URL')"></td>
				<td align="left" v-text="project['repo_url']"></td>
			</tr>
			<tr v-if="project['repo_type'] === 'git'">
				<td v-text="i18n('Branch to build')"></td>
				<td align="left" v-text="project['repo_branch'] || 'master'"></td>
			</tr>
			</tbody>
		</table>
	</div>
	<h3 class="sub-title" v-text="i18n('Operation Scripts')"></h3>
	<div class="table-wrapper">
		<table>
			<thead>
			<tr>
				<th v-text="i18n('Name')"></th>
				<th v-text="i18n('Script')"></th>
				<th v-text="i18n('Options')"></th>
			</tr>
			</thead>
			<tbody>
			<tr v-for="script in project['operation_scripts']">
				<td v-text="script['name']"></td>
				<td v-text="script['command'] | command"></td>
				<td>
					<a class="option" @click="executeScript($index)" v-text="i18n('Execute')"></a>
				</td>
			</tr>
			</tbody>
		</table>
	</div>
	<h3 class="sub-title" v-text="i18n('Build Histories')"></h3>
	<div class="table-wrapper">
		<table>
			<thead>
			<tr>
				<th v-text="i18n('ID')"></th>
				<th v-text="i18n('Start Time')"></th>
				<th v-text="i18n('Duration')"></th>
				<th v-text="i18n('Status')"></th>
				<th v-text="i18n('Options')"></th>
			</tr>
			</thead>
			<tbody>
			<tr v-for="history in project['histories'] | orderBy 'start_time' -1" track-by="$index">
				<td>
					<a v-text="'#' + $key" :href="'/projects/' + project['name'] + '/histories/' + $key"></a>
				</td>
				<td v-text="history['start_time'] | datetime"></td>
				<td v-text="history['duration'] | duration"></td>
				<td>
					<a class="tag {{['', 'color-info', 'color-success', 'color-danger', 'color-warning'][history['status']]}}"
					   v-text="[i18n('Initial'), i18n('Building'), i18n('Success'), i18n('Failed'), i18n('Aborted')][history['status']]"
					   :href="'/projects/' + project['name'] + '/histories/' + $key"></a>
				</td>
				<td>
					<template v-if="history['build_url']">
						<a class="option" :href="history['build_url']" v-text="i18n('Download')"></a>
						<a class="option" @click="deploy($key)" v-if="project['deploy_nodes']"
						   v-text="i18n('Revert')"></a>
					</template>
				</td>
			</tr>
			</tbody>
		</table>
	</div>
	<div class="mask" :style="{display: executing || executionResult ? 'block' : null}"></div>
	<div class="dialog" :style="{display: executing || executionResult ? 'block' : null}">
		<div class="title" v-text="i18n('Execution Result')"></div>
		<button class="close" @click="closeDialog" v-text="i18n('Close')"></button>
		<div class="content">
			<pre v-html="executionResult"></pre>
			<i class="loading" v-if="executing"></i>
		</div>
	</div>
</div>
<script src="/js/libs/vue.js"></script>
<script src="/js/libs/reqwest.min.js"></script>
<script src="/js/common.js"></script>
<script src="/js/project_info.js"></script>
</body>
</html>