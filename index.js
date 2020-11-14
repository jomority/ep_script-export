var eejs = require("ep_etherpad-lite/node/eejs");
var settings = require('ep_etherpad-lite/node/utils/Settings');
var padManager = require("ep_etherpad-lite/node/db/PadManager");
var exportHtml = require("ep_etherpad-lite/node/utils/ExportHtml");
var spawnSync = require("child_process").spawnSync;

function getDisplayName() {
	if ("ep_script-export" in settings)
		return settings["ep_script-export"]["displayname"] || "Script";

	return undefined;
}

function getExportScripts(padID) {
	if (!("ep_script-export" in settings))
		return undefined;

	if (!("mapping" in settings["ep_script-export"]))
		return undefined;

	for (let [k, v] of Object.entries(settings["ep_script-export"]["mapping"]))
		if (padID.startsWith(k))
			return v;

	return undefined;
}

exports.eejsBlock_exportColumn = function(hook_name, args, cb) {
	var urlsplit = args.renderContext.req.url.split("/");
	var padID = urlsplit[2];
	if (getExportScripts(padID) !== undefined)
		args.content = args.content + eejs.require('./templates/exportcolumn.html', {displayname: getDisplayName(), href: ["", urlsplit[1], urlsplit[2], "export/script"].join("/")}, module);
	return cb();
};

async function getHTML(padID, revision, cb) {
	if (!await padManager.doesPadExists(padID))
		return cb("pad does not exist", null);

	var pad = await padManager.getPad(padID);

	if (revision !== undefined) {
		var head = pad.getHeadRevisionNumber();
		if (revision > head)
			return cb("revision is higher than the head revision of the pad", null);
	}

	var html = await exportHtml.getPadHTML(pad, revision);

	cb(null, html);
}

function callScript(script, html) {
	if(!(script instanceof Array && script.length >= 1))
		throw "cannot execute " + script;

	var ret = spawnSync(script[0], script.slice(1), { "input": html });

	if (ret.error)
		throw ret.error;
	if (ret.status !== 0)
		throw "non-zero exit code (" + ret.status + "):<br/>" + String(ret.stderr).replace("\n", "<br/>");

	return ret.output;
}

exports.expressCreateServer = function(hook_name, args, cb) {
	args.app.get('/p/:pad/:rev?/export/script', function(req, res) {
		var padID = req.params.pad;
		var revision = req.params.rev ? req.params.rev : null;

		var scripts = getExportScripts(padID);

		if (scripts == undefined) {
			res.send("ERROR: script export not possible for this pad group");
			return;
		}
		
		getHTML(padID, revision, function(err, result) {
			if(err) {
				res.send("ERROR: " + err);
				return;
			};

			if (req.query.export === "do")
				var script = "export";
			else if ("preview" in scripts)
				var script = "preview";

			var preview, stderr;
			if (script) {
				try {
					var output = callScript(scripts[script], result);
				} catch (e) {
					res.send("ERROR in " + script + " script: " + e);
					return;
				}
				preview = output[1];
				stderr = output[2];
			}

			res.send(eejs.require('./templates/export.html', {script: script, stderr: stderr, preview: preview}, module));
		});
	});

	return cb();
};
