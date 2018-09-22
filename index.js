#!/usr/bin/env node
const commander = require("commander");
const process = require("process");
const analyzer = require("./analyzer.js");

const program = commander.option("-f, --file").action(file => {
    var cwd = process.cwd();
    var errors = analyzer.analyzeUsingFileSystem(cwd, file);
    analyzer.logErrorsAndExit(errors);
})

program.parse(process.argv);