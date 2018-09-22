const path = require("path");
const fs = require("fs");
const chalk = require("chalk");

const babelParser = require("@babel/parser");
const traverse = require("babel-traverse").default;
const levenshtein = require('fast-levenshtein');
const union = require("tagmeme").union;

const AnalyzerError = union([
    'UnionTypeNameIncorrect', 
    'UnionCaseDeclaredButNotHandled',
    'UnionCaseHandledButNotDeclared',
    'RedundantCatchAllArgument',
    'UsingMatchAsUnionCase'
]); 

// detects when the 'union' function is imported from tagmeme in ES6 syntax
// default import: import { union } from 'tagmeme'
// aliased import: import { union as makeUnion } from 'tagmeme'
const unionImported = function(node) {
    return node.type === "ImportDeclaration" 
        && node.specifiers.length === 1
        && node.specifiers[0].imported.name === "union"
        && node.source.value === "tagmeme";
}

// detects when the 'union' function is imported from tagmeme in ES5 syntax
// default import: const union = require('tagmeme').union
// aliased import: const makeUnion = requore('tagmeme').union
const unionRequired = function (node) {
    return node.type === "VariableDeclaration"
        && node.declarations.length === 1 
        && node.declarations[0].init.type === "MemberExpression"
        && node.declarations[0].init.property.name === "union"
        && node.declarations[0].init.object.type === "CallExpression"
        && node.declarations[0].init.object.callee.name === "require"
        && node.declarations[0].init.object.arguments.length === 1
        && node.declarations[0].init.object.arguments[0].value === "tagmeme";
}

const localValueImport = function (node) {
    return node.type === "ImportDeclaration" 
        && node.source.type === "StringLiteral"
        && node.source.value.startsWith(".")
}

// type ImportDecl =
// | UnionImport of { local: string, imported: string, union: bool } 
// | LocalImport of { union: bool, imports: [{ local: string, imported: string }]

// findImports : Node array -> ImportDecl array
const findImports = function (nodes) {
    return nodes
        .filter(node => unionImported(node) || unionRequired(node) || localValueImport(node))
        .map(node => {
            if (unionImported(node)) {
                return { 
                    imported: node.specifiers[0].imported.name,
                    local: node.specifiers[0].local.name,
                    union: true 
                }
            } else if (unionRequired(node)) {
                return {
                    local: node.declarations[0].id.name, 
                    imported: node.declarations[0].init.property.name,
                    union: true 
                }
            } else {
                // local imports
                return {
                    union: false, 
                    source: node.source.value,
                    imports: node.specifiers.map(spec => {
                        return {
                            local: spec.local.name,
                            imported: spec.imported.name
                        }
                    })
                }
            }
        });
}

const findExports = function (nodes) {
    //console.log(nodes);
    return nodes.filter(node => {
        return node.type === "ExportNamedDeclaration"
    }).map(node => {
        return node.declaration;
    });
}

const findUnionDeclarations = function (nodes, currentFile, readFile) {
    
    const importDeclarations = findImports(nodes);
    const unionImports = importDeclarations.filter(decl => decl.union); 
    const localImports =  importDeclarations.filter(decl => !decl.union);
    const externalDeclarations = [];

    if (localImports.length > 0) {
        
        // find exports from external file
        // match with imported values
        for (var i = 0; i < localImports.length; i++) {
            const importDecl = localImports[i];
            const externalFile = importDecl.source; 
            const withExtension = externalFile.endsWith(".js") ? externalFile : externalFile + ".js";
            const externalFilePath = path.resolve(currentFile, "..", withExtension);
            // read external ast and find declartions from there
            const externalContent = readFile(externalFilePath);
            const externalAst = babelParser.parse(externalContent, { sourceType: "module" });
            const detectedExternalDeclarations = findUnionDeclarations(externalAst.program.body, externalFilePath, readFile);
           
            for (var i = 0; i < detectedExternalDeclarations.length; i++) {
                externalDeclarations.push(detectedExternalDeclarations[i]);
            }
            
        }
    }

    if (unionImports.length === 0) {
        return externalDeclarations;
    }

    const localUnionId = importDeclarations[0].local;

    return nodes.concat(findExports(nodes)).filter(node => {
        return node.type === "VariableDeclaration" 
            && node.declarations.length === 1
            && node.declarations[0].id.type === "Identifier"
            && node.declarations[0].init.type === "CallExpression"
            && node.declarations[0].init.callee.name === localUnionId
            && node.declarations[0].init.arguments.length === 1
            && node.declarations[0].init.arguments[0].type === "ArrayExpression";
    }).map(node => {
        return { 
            unionType: node.declarations[0].id.name, 
            loc: node.loc,
            cases: node.declarations[0].init.arguments[0].elements.map(elem => elem.value)
        }
    }); 
}

const findMatchUsages = function(ast) {
    const matchUsages = [ ];
    
    traverse(ast, {
        enter(path) {
          const node = path.node; 
          const isMatchCall = 
               node.type === "CallExpression"
            && node.callee.type === "MemberExpression"
            && node.callee.property.name === "match"
            && (node.arguments.length === 2 || node.arguments.length === 3);

            if (isMatchCall) {
                matchUsages.push({
                    unionType: node.callee.object.name, 
                    loc: node.loc,
                    cases: node.arguments[1].properties, 
                    usedCatchAll: node.arguments.length === 3
                })
            }
        }
    });

    return matchUsages;
}

const normalize = function (n) {
    if (n < 10) return "0" + n.toString(); 
    return n.toString();
}; 

const fsReader = filename => fs.readFileSync(filename, "utf8");

const analyze = function (cwd, filename, syncReader) {
    const errors = [ ]; 
    const fullPath = path.resolve(cwd, filename) 
    const contents = syncReader(fullPath);
    const codeAst = babelParser.parse(contents, { sourceType: "module" });
    const unionDeclarations = findUnionDeclarations(codeAst.program.body, fullPath, syncReader); 
    const matchUsages = findMatchUsages(codeAst);

    unionDeclarations.forEach(decl => {
        for(var i = 0; i < decl.cases.length; i++) {
            if (decl.cases[i] === "match") {
                errors.push(AnalyzerError.UsingMatchAsUnionCase({
                    modulePath: fullPath,
                    location: decl.loc,
                    errorMessage: "Declaration of union cases for type '" + decl.unionType + "' cannot contain 'match' as a union case"
                }))
            }
        }
    });

    for (var i = 0; i < matchUsages.length; i++) {
        const currentUsage = matchUsages[i];
        const pathLog = fullPath + ":" + normalize(currentUsage.loc.start.line) + ":" + normalize(currentUsage.loc.end.line);
        const isDeclared = unionDeclarations.some(decl => decl.unionType === currentUsage.unionType);

        if (!isDeclared) {
            // used type name was not found in the array of declared union types => probably a typo
            const nearbyWordExists = unionDeclarations.some(decl => levenshtein.get(decl.unionType, currentUsage.unionType) <= 2);
            if (nearbyWordExists) {
                const nearbyWords = unionDeclarations.filter(decl => levenshtein.get(decl.unionType, currentUsage.unionType) <= 2);
                if (nearbyWords.length === 1) {

                    const alternativeTypeName = nearbyWords[0].unionType;

                    const unionTypeNameIncorrect = AnalyzerError.UnionTypeNameIncorrect({
                        modulePath: fullPath, 
                        location: currentUsage.loc,
                        usedTypeName: currentUsage.unionType,
                        possibleAlternatives: [alternativeTypeName], 
                        errorMessage: "Detected use of 'match' for type '" + currentUsage.unionType + "' but no declaration of the type was found, did you mean '" + alternativeTypeName + "'?"
                    });

                    errors.push(unionTypeNameIncorrect);
        
                } else {

                    const possibleWords = nearbyWords.map(word => word.unionType).join(",");

                    const unionTypeNameIncorrect = AnalyzerError.UnionTypeNameIncorrect({
                        modulePath: fullPath, 
                        location: currentUsage.loc,
                        usedTypeName: currentUsage.unionType,
                        possibleAlternatives: possibleWords, 
                        errorMessage: "Detected use of 'match' for type '" + currentUsage.unionType + "' but no declaration of the type was found, did you mean '" + nearbyWords[0].unionType + "'?"
                    });

                    errors.push(unionTypeNameIncorrect);
                }
            } else {
                
                const unionTypeNameIncorrect = AnalyzerError.UnionTypeNameIncorrect({
                    modulePath: fullPath, 
                    location: currentUsage.loc,
                    usedTypeName: currentUsage.unionType,
                    possibleAlternatives: [], 
                    errorMessage: "Detected use of 'match' for type '" + currentUsage.unionType + "' but no declaration of the type was found"
                });

                errors.push(unionTypeNameIncorrect);
            }

            continue;
        }

        const declarations =  unionDeclarations.filter(decl => decl.unionType === currentUsage.unionType);
        const declaredUnion = declarations[0];
        const declaredCases = declaredUnion.cases; 
        const usedCases = currentUsage.cases;

        const allCasesHandled = 
            declaredCases.every(declaredCase => usedCases.some(usedCase => usedCase.key.name === declaredCase))
         && usedCases.every(usedCase => declaredCases.some(declaredCase => declaredCase === usedCase.key.name));

        
        if (allCasesHandled && currentUsage.usedCatchAll) {
            
            errors.push(AnalyzerError.RedundantCatchAllArgument({ 
                modulePath: fullPath, 
                location: currentUsage.loc,
                errorMessage: "All cases were handled, the second argument of function 'match' (catchAll) is redundant and can be removed"
            }))

            //log(pathLog, "All cases were handled, the second argument of function 'match' (catchAll) is redundant and can be removed");
        } 

        if (allCasesHandled) {
            // everything is good, move on...
            continue;
        }

        if (!currentUsage.usedCatchAll) {
            // no catchAll is being used
            const usedCasesNames = usedCases.map(usedCase => usedCase.key.name);
            // go through the handled cases in the `match` function, check whether a case was used in `match` but wasn't declared
            // this detects common typo's in the used cases
            for (var j = 0; j < usedCasesNames.length; j++) {
                const currentKey = usedCasesNames[j];
                const usedKeyIsDeclared = declaredCases.some(declaredCase => currentKey === declaredCase);
                // Typo's: using a key that isn't declared in the original type
                if (!usedKeyIsDeclared) {
                    const nearbyWordExists = declaredCases.some(declaredCase => levenshtein.get(declaredCase, currentKey) <= 2);
                    if (nearbyWordExists) {
                        const nearbyWords = declaredCases.filter(declaredCase => levenshtein.get(declaredCase, currentKey) <= 2);
                        
                        if (nearbyWords.length === 1) {
                            
                            errors.push(AnalyzerError.UnionCaseHandledButNotDeclared({ 
                                modulePath: fullPath, 
                                location: currentUsage.loc,
                                usedUnionType: declaredUnion.unionType,
                                usedUnionCase: currentKey, 
                                possibleAlternatives: nearbyWords,
                                errorMessage: "Detected match against union case '" + currentKey + "' but no declaration of this case was found in type '" + declaredUnion.unionType + "', did you mean '" + nearbyWords[0] + "'?"
                            }));
 
                        } else {

                            const possibleWords = nearbyWords.join(", ");

                            errors.push(AnalyzerError.UnionCaseHandledButNotDeclared({ 
                                modulePath: fullPath, 
                                location: currentUsage.loc,
                                usedUnionType: declaredUnion.unionType,
                                usedUnionCase: currentKey, 
                                possibleAlternatives: nearbyWords,
                                errorMessage: "Detected match against union case '" + currentKey + "' but no declaration of this case was found in type" + declaredUnion.unionType + ", did you mean '" + possibleWords + "'?"
                            }));
                        }

                    } else {

                        errors.push(AnalyzerError.UnionCaseHandledButNotDeclared({ 
                            modulePath: fullPath, 
                            location: currentUsage.loc,
                            usedUnionType: declaredUnion.unionType,
                            usedUnionCase: currentKey, 
                            possibleAlternatives: [],
                            errorMessage: "Detected match against union case '" + currentKey + "' but no declaration of this case was found in type '" + declaredUnion.unionType + "'"
                        }));
                    }

                    continue;
                }
            }

            // now go through declared cases and check whether all of them are handled
            // this detects common "forgotten" cases
            for (var k = 0; k < declaredCases.length; k++) {
                const declaredCase = declaredCases[k];
                const declaredCaseHandled = usedCasesNames.some(caseName => caseName === declaredCase);

                if (!declaredCaseHandled) {

                    errors.push(AnalyzerError.UnionCaseDeclaredButNotHandled({ 
                        modulePath: fullPath, 
                        location: currentUsage.loc,
                        usedUnionType: declaredUnion.unionType,
                        declaredUnionCase: declaredCase, 
                        possibleAlternatives: [],
                        errorMessage: "Declared union case '" + declaredCase + "' was found in the type '" + declaredUnion.unionType + "' but it wasn't handled in the 'match' function"
                    }));
                }
            }
        }
    }

    return errors;
}

const log = (sourcePath, msg) => { 
    console.log(chalk.cyan(sourcePath));
    console.log(chalk.bgRed(msg));
}

const logErrorsAndExit = errors => {
    
    if (errors.length === 0) {
        console.log(chalk.green("No errors found"));
        process.exit(0);
    } 
    const errorWord = errors.length === 1 ? " error" : " errors"
    console.log(chalk.bgRed("Found " + errors.length + errorWord));
    for(var i = 0; i < errors.length; i++) {
        const errorLocation = errors[i]["_data"].location; 
        const modulePath = errors[i]["_data"].modulePath;
        const errorMsg = errors[i]["_data"].errorMessage;
        const sourcePath = modulePath + ":" + normalize(errorLocation.start.line) + ":" + normalize(errorLocation.end.line);
        console.log(chalk.cyan(sourcePath));
        console.log(chalk.bgRed(errorMsg));
    }

    process.exit(1);
};

const analyzeUsingFileSystem = (cwd, filename) => analyze(cwd, filename, fsReader);

module.exports = {
    unionImported: unionImported,
    unionRequired: unionRequired,
    findImports: findImports, 
    findExports: findExports,
    findUnionDeclarations: findUnionDeclarations,
    analyze: analyze,
    logErrorsAndExit: logErrorsAndExit,
    analyzeUsingFileSystem: analyzeUsingFileSystem,
    AnalyzerError: AnalyzerError
}