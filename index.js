#!/usr/bin/env node
const commander = require("commander");
const process = require("process");
const analyzer = require("./analyzer.js");
const fs = require("fs");

const program = commander.option("-f, --file").action(file => {
    const currentWorkingDirectory = process.cwd();
    const fileSystemReader = filename => fs.readFileSync(filename, "utf8");
    const errors = analyzer.analyze(currentWorkingDirectory, file, fileSystemReader);
    analyzer.logErrorsAndExit(errors, error => console.log(error), process);
})

program.parse(process.argv);