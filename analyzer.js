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
    'RedundantCatchAllArgument'
]); 


// detect: import { union } from 'tagmeme' 
const unionImported = function(node) {
    return node.type === "ImportDeclaration" 
        && node.specifiers.length === 1
        && node.specifiers[0].imported.name === "union"
        && node.source.value === "tagmeme";
}

// detect: const union = require('tagmeme').union
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

const findImports = function (nodes) {
    return nodes
        .filter(node => unionImported(node) || unionRequired(node))
        .map(node => {
            if (unionImported(node)) {
                return { 
                    imported: node.specifiers[0].imported.name,
                    local: node.specifiers[0].local.name 
                }
            } else {
                return {
                    local: node.declarations[0].id.name, 
                    imported: node.declarations[0].init.property.name
                }
            }
        });
}

const findUnionDeclarations = function (nodes, tagmemeImports) {
    
    if (tagmemeImports.length === 0) {
        return []
    };

    const localUnionId = tagmemeImports[0].local;

    return nodes.filter(node => {
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

const log = (sourcePath, msg) => { 
    console.log(chalk.cyan(sourcePath));
    console.log(chalk.bgRed(msg));
}

const fsReader = filename => fs.readFileSync(filename, "utf8");

const analyze = function (filename, syncReader) {
    const errors = [ ]; 
    const fullPath = path.resolve(__dirname, filename) 
    const contents = syncReader(fullPath);
    const codeAst = babelParser.parse(contents, { sourceType: "module" });
    const tagmemeImports = findImports(codeAst.program.body);
    const unionDeclarations = findUnionDeclarations(codeAst.program.body, tagmemeImports); 
    const matchUsages = findMatchUsages(codeAst);

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
                        errorMessage: "Detected use of 'match' for type '" + currentUsage.unionType + "' but no declaration of the type was found, did you mean '" + alternativeTypeName + "'"
                    });

                    errors.push(unionTypeNameIncorrect);
                    //log(pathLog, "Detected use of 'match' for type '" + currentUsage.unionType + "' but no declaration of the type was found, did you mean '" + alternativeTypeName + "'");
                
                } else {

                    const possibleWords = nearbyWords.map(word => word.unionType).join(",");

                    const unionTypeNameIncorrect = AnalyzerError.UnionTypeNameIncorrect({
                        modulePath: fullPath, 
                        location: currentUsage.loc,
                        usedTypeName: currentUsage.unionType,
                        possibleAlternatives: possibleWords, 
                        errorMessage: "Detected use of 'match' for type '" + currentUsage.unionType + "' but no declaration of the type was found, did you mean '" + nearbyWords[0].unionType + "'"
                    });

                    errors.push(unionTypeNameIncorrect);
                    
                    //log(pathLog, "Detected use of 'match' for type '" + currentUsage.unionType + "' but no declaration of the type was found, did you mean any of these: [" + possibleWords + "].");
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

                //log(pathLog, "Detected use of 'match' for type '" + currentUsage.unionType + "' but no declaration of the type was found");
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
                                errorMessage: "Detected match against union case '" + currentKey + "' but no declaration of this case was found in type" + declaredUnion.unionType + ", did you mean '" + nearbyWords[0] + "'"
                            }));

                            // log(pathLog, "Detected match against union case '" + currentKey + "' but no declaration of this case was found in type" + declaredUnion.unionType + ", did you mean '" + nearbyWords[0] + "'");
                        
                        } else {

                            const possibleWords = nearbyWords.join(", ");

                            errors.push(AnalyzerError.UnionCaseHandledButNotDeclared({ 
                                modulePath: fullPath, 
                                location: currentUsage.loc,
                                usedUnionType: declaredUnion.unionType,
                                usedUnionCase: currentKey, 
                                possibleAlternatives: nearbyWords,
                                errorMessage: "Detected match against union case '" + currentKey + "' but no declaration of this case was found in type" + declaredUnion.unionType + ", did you mean '" + possibleWords + "'"
                            }));

                            
                            //log(pathLog, "Detected match against union case '" + currentKey + "' but no declaration of this case was found in type '" + declaredUnion.unionType + "', did you mean one of these cases: [" + possibleWords + "].");
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

                        //log(pathLog,"Detected match against union case '" + currentKey + "' but no declaration of this case was found in type '" + declaredUnion.unionType + "'.");
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

                    //log(pathLog, "Declared union case '" + declaredCase + "' was found in the type '" + declaredUnion.unionType + "' but it wasn't handled in the 'match' function");
                }
            }
        }
    }

    return errors;
}

const analyzeUsingFileSystem = filename => analyze(filename, fsReader);

module.exports = {
    unionImported: unionImported,
    unionRequired: unionRequired,
    findImports: findImports, 
    findUnionDeclarations: findUnionDeclarations,
    analyze: analyze,
    analyzeUsingFileSystem: analyzeUsingFileSystem,
    AnalyzerError: AnalyzerError
}