const assert = require("assert");
const analyzer = require("../analyzer.js");
const babelParser = require("@babel/parser");
const AnalyzerError = analyzer.AnalyzerError;

describe("Analyzer", function() {

    describe("findImports()", function() { 

        it("Works with default ES6 import", function() { 
            const code = "import { union } from 'tagmeme'";
            const ast = babelParser.parse(code, { sourceType: "module" });
            const foundImports = analyzer.findImports(ast.program.body);
            assert.equal(1, foundImports.length);
            assert.equal("union", foundImports[0].local);
            assert.equal("union", foundImports[0].imported);
        });

        it("Works with aliased ES6 import", function() { 
            const code = "import { union as makeUnion } from 'tagmeme'";
            const ast = babelParser.parse(code, { sourceType: "module" });
            const foundImports = analyzer.findImports(ast.program.body);
            assert.equal(1, foundImports.length);
            assert.equal("makeUnion", foundImports[0].local);
            assert.equal("union", foundImports[0].imported);
        });

        it("Works with default ES5 require", function() { 
            const code = "const union = require('tagmeme').union;"
            const ast = babelParser.parse(code, { sourceType: "module" });
            const foundImports = analyzer.findImports(ast.program.body);
            assert.equal(1, foundImports.length);
            assert.equal("union", foundImports[0].local);
            assert.equal("union", foundImports[0].imported);
        });

        it("Works with aliased ES5 require", function() { 
            const code = "const makeUnion = require('tagmeme').union;"
            const ast = babelParser.parse(code, { sourceType: "module" });
            const foundImports = analyzer.findImports(ast.program.body);
            assert.equal(1, foundImports.length);
            assert.equal("makeUnion", foundImports[0].local);
            assert.equal("union", foundImports[0].imported);
        });

        it("Does not import from other libraries in ES5 syntax", function() { 
            const code = "const makeUnion = require('some-library').union;"
            const ast = babelParser.parse(code, { sourceType: "module" });
            const foundImports = analyzer.findImports(ast.program.body);
            assert.equal(0, foundImports.length);
        });

        it("Does not import from other libraries in ES6 syntax", function() { 
            const code = "import { union as makeUnion }  from 'some-library'"
            const ast = babelParser.parse(code, { sourceType: "module" });
            const foundImports = analyzer.findImports(ast.program.body);
            assert.equal(0, foundImports.length);
        });
    });

    describe("findExports()", function() {
        it("Returns the exported declarations", function() {
            const code = [
                "import { union } from 'tagmeme'",
                "export const Option = union([ 'Some', 'None' ])",
                "export const Result = union([ 'Ok', 'Error' ])"
            ]

            const ast = babelParser.parse(code.join("\n"), { sourceType: "module" });
            const foundExports = analyzer.findExports(ast.program.body);
            assert.equal(2, foundExports.length);
        });
    });

    describe("groupBy()", function() {
        it("hopefully works...", function() { 
            const declaration = {
                unionType: 'Option',
                cases: ['Some', 'None', 'None']
            }

            const groups = analyzer.groupBy(declaration.cases, caseName => caseName);
            const keys = Object.keys(groups);
            assert.equal(2, keys.length);
            assert.equal(1, groups['Some'].length);
            assert.equal(2, groups['None'].length);
        })
    });



    describe("findUnionDeclarations()", function() {

        it("finds declarations constructed using 'union'", function() {
            
            const code = [ 
                "import { union } from 'tagmeme'",
                "const Option = union([ 'Some', 'None' ])"
            ];

            const ast = babelParser.parse(code.join("\n"), { sourceType: "module" });
            const irrelevantFile = "./irrelevant"
            const irrelevantReader = filePath => "Some content";
            const declarations = analyzer.findUnionDeclarations(ast.program.body, irrelevantFile, irrelevantReader);
            assert.equal(1, declarations.length);
            assert.equal("Option", declarations[0].unionType);
            assert.deepEqual([ 'Some', 'None' ], declarations[0].cases);
        });

        it("finds declarations constructed using aliased 'union'", function() {
            
            const code = [ 
                "import { union as makeUnion } from 'tagmeme'",
                "const Option = makeUnion([ 'Some', 'None' ])"
            ];

            const ast = babelParser.parse(code.join("\n"), { sourceType: "module" });
            const irrelevantFile = "./irrelevant"
            const irrelevantReader = filePath => "Some content";
            const declarations = analyzer.findUnionDeclarations(ast.program.body, irrelevantFile, irrelevantReader);
            assert.equal(1, declarations.length);
            assert.equal("Option", declarations[0].unionType);
            assert.deepEqual([ 'Some', 'None' ], declarations[0].cases);
        });

        it("finds multiple declarations constructed using aliased 'union'", function() {
            
            const code = [ 
                "import { union as makeUnion } from 'tagmeme'",
                "const Option = makeUnion([ 'Some', 'None' ])",
                "const Result = makeUnion([ 'Ok', 'Error' ])"
            ];

            const ast = babelParser.parse(code.join("\n"), { sourceType: "module" });
            const irrelevantFile = "./irrelevant"
            const irrelevantReader = filePath => "Some irrelevant content that will not be read";
            const declarations = analyzer.findUnionDeclarations(ast.program.body, irrelevantFile, irrelevantReader);
            assert.equal(2, declarations.length);
            assert.equal("Option", declarations[0].unionType);
            assert.deepEqual([ 'Some', 'None' ], declarations[0].cases);
            assert.equal("Result", declarations[1].unionType);
            assert.deepEqual([ 'Ok', 'Error' ], declarations[1].cases);
        });

        it("finds exported declarations", function() {
            const code = [ 
                "import { union as makeUnion } from 'tagmeme'",
                "export const Option = makeUnion([ 'Some', 'None' ])",
                "export const Result = makeUnion([ 'Ok', 'Error' ])"
            ];

            const ast = babelParser.parse(code.join("\n"), { sourceType: "module" });
            const irrelevantFile = "./irrelevant"
            const irrelevantReader = filePath => "Some irrelevant content that will not be read";
            const declarations = analyzer.findUnionDeclarations(ast.program.body, irrelevantFile, irrelevantReader);
            assert.equal(2, declarations.length);
            assert.equal("Option", declarations[0].unionType);
            assert.deepEqual([ 'Some', 'None' ], declarations[0].cases);
            assert.equal("Result", declarations[1].unionType);
            assert.deepEqual([ 'Ok', 'Error' ], declarations[1].cases);
        });

        it("finds external declarations", function() {
            const types = [
                "import { union } from 'tagmeme'",
                "export const Result = union([ 'Ok', 'Error' ])",
                "export const Option = union([ 'Some', 'None' ])"
            ];

            const app = [
                "import { Option } from './types'",
                "import { Result } from './types'"
            ]

            const ast = babelParser.parse(app.join("\n"), { sourceType: "module" });
            const irrelevantFile = "./irrelevant"
            const typesReader = filePath => types.join("\n");
            const declarations = analyzer.findUnionDeclarations(ast.program.body, irrelevantFile, typesReader);
            assert.equal(2, declarations.length);
            assert.equal("Option", declarations[1].unionType);
            assert.deepEqual([ 'Some', 'None' ], declarations[1].cases);
            assert.equal("Result", declarations[0].unionType);
            assert.deepEqual([ 'Ok', 'Error' ], declarations[0].cases);
        });
    });

    describe("analyze()", function() { 
        it("returns no errors for valid use of pattern matching", function() {
            const code = [ 
                "import { union as makeUnion } from 'tagmeme';",
                "const Result = makeUnion([ 'Ok', 'Error' ]);",
                "const success = Result.Ok(1);",
                "const value = Result.match(success, {",
                "  Ok: n => n + 1,",
                "  Error: () => 0",
                "})",
            ];

            const mockReader = filename => code.join("\n");
            const errors = analyzer.analyze("cwd", "./irrelevant-filename", mockReader);
            assert.equal(0, errors.length);
        }); 

        it("returns an error when type name is incorrect", function() {
            const code = [ 
                "import { union as makeUnion } from 'tagmeme';",
                "const Result = makeUnion([ 'Ok', 'Error' ]);",
                "const success = Result.Ok(1);",
                // Detect typo: => used 'Tesult' instead of 'Result'
                "const value = Tesult.match(success, {",
                "  Ok: n => n + 1,",
                "  Error: () => 0",
                "})",
            ];

            const mockReader = filename => code.join("\n");
            const errors = analyzer.analyze("cwd", "./irrelevant-filename", mockReader);
            assert.equal(1, errors.length);
            
            AnalyzerError.match(errors[0], {
                UnionTypeNameIncorrect: errorInfo => {
                    assert.equal('Tesult', errorInfo.usedTypeName);
                    assert.deepEqual([ 'Result' ], errorInfo.possibleAlternatives);
                }
            }, () => assert.fail('Expected analyzer error of union case UnionTypeNameIncorrect')); 
        }); 

        it("returns an error when a union case is declared but not handled", function() {
            const code = [ 
                "import { union as makeUnion } from 'tagmeme';",
                "const Result = makeUnion([ 'Ok', 'Error' ]);",
                "const success = Result.Ok(1);",
                // Error => forgot to handle 'Error' union case
                "const value = Result.match(success, { Ok: n => n + 1 })"
            ];

            const mockReader = filename => code.join("\n");
            const errors = analyzer.analyze("cwd", "./irrelevant-filename", mockReader);
            assert.equal(1, errors.length);
            
            AnalyzerError.match(errors[0], {
                UnionCaseDeclaredButNotHandled: errorInfo => {
                    assert.equal('Result', errorInfo.usedUnionType);
                    assert.deepEqual('Error', errorInfo.declaredUnionCase);
                }
            }, () => assert.fail('Expected analyzer error of union case UnionTypeNameIncorrect')); 
        }); 

        it("returns no error if catchAll argument is present to handle other cases", function() {
            const code = [ 
                "import { union as makeUnion } from 'tagmeme';",
                "const Result = makeUnion([ 'Ok', 'Error' ]);",
                "const success = Result.Ok(1);",
                "const value = Result.match(success, { Ok: n => n + 1 }, () => 0)"
            ];

            const mockReader = filename => code.join("\n");
            const errors = analyzer.analyze("cwd", "./irrelevant-filename", mockReader);
            assert.equal(0, errors.length);
        }); 

        it("returns an error when a case is handled but not declared in the type", function() {
            const code = [ 
                "import { union as makeUnion } from 'tagmeme';",
                "const Result = makeUnion([ 'Ok', 'Error' ]);",
                "const success = Result.Ok(1);",
                // Error => handling too many cases, the 'Other' case in not declared in the `Result`
                "const value = Result.match(success, { Ok: n => n + 1, Error: () => 1, Other: () => 3 })"
            ];

            const mockReader = filename => code.join("\n");
            const errors = analyzer.analyze("cwd", "./irrelevant-filename", mockReader);
            assert.equal(1, errors.length);
            AnalyzerError.match(errors[0], { 
                UnionCaseHandledButNotDeclared: errorInfo => {
                    assert.equal('Result', errorInfo.usedUnionType);
                    assert.equal('Other', errorInfo.usedUnionCase);
                }
            }, () => assert.fail('Expected analyzer error of union case UnionCaseHandledButNotDeclared'));
        }); 

        it("returns an error when a case is handled but not declared in the type with multiple possible alternatives", function() {
            const code = [ 
                "import { union as makeUnion } from 'tagmeme';",
                "const Result = makeUnion([ 'Erro', 'Error' ]);",
                "const success = Result.Ok(1);",
                // Error => handling too many cases, the 'Other' case in not declared in the `Result`
                "const value = Result.match(success, { Erro: n => n + 1, Error: () => 1, Erron: () => 3 })"
            ];

            const mockReader = filename => code.join("\n");
            const errors = analyzer.analyze("cwd", "./irrelevant-filename", mockReader);
            assert.equal(1, errors.length);
            AnalyzerError.match(errors[0], { 
                UnionCaseHandledButNotDeclared: errorInfo => {
                    assert.equal('Result', errorInfo.usedUnionType);
                    assert.equal('Erron', errorInfo.usedUnionCase);
                }
            }, () => assert.fail('Expected analyzer error of union case UnionCaseHandledButNotDeclared'));
        }); 

        it("returns an error when a case has a duplicate declaration", function() {
            const code = [ 
                "import { union as makeUnion } from 'tagmeme';",
                "const Duplicated = makeUnion([ 'Ok', 'Ok' ]);"
            ];

            const mockReader = filename => code.join("\n");
            const errors = analyzer.analyze("cwd", "./irrelevant-filename", mockReader);
            assert.equal(1, errors.length);
            AnalyzerError.match(errors[0], { 
                DuplicateUnionCaseDeclaration: errorInfo => assert.ok(true)
            }, () => assert.fail('Expected analyzer error of union case UnionCaseHandledButNotDeclared'));
        }); 

        it("returns an error when 'match' is used as a union case", function() {
            const code = [ 
                "import { union as makeUnion } from 'tagmeme';",
                "const UsesMatch = makeUnion([ 'Ok', 'Error', 'match' ]);"
            ];

            const mockReader = filename => code.join("\n");
            const errors = analyzer.analyze("cwd", "./irrelevant-filename", mockReader);
            assert.equal(1, errors.length);
            AnalyzerError.match(errors[0], { 
                UsingMatchAsUnionCase: errorInfo => assert.ok(true)
            }, () => assert.fail('Expected analyzer error of union case UnionCaseHandledButNotDeclared'));
        }); 

        it("returns an error when all cases are handled and catchAll is redundant", function() {
            const code = [ 
                "import { union as makeUnion } from 'tagmeme';",
                "const Result = makeUnion([ 'Ok', 'Error' ]);",
                "const success = Result.Ok(1);",
                // Error => catchAll (2nd arg) is redundant
                "const value = Result.match(success, { Ok: n => n + 1, Error: () => 1 }, () => 0)"
            ];

            const mockReader = filename => code.join("\n");
            const errors = analyzer.analyze("cwd", "./irrelevant-filename", mockReader);
            assert.equal(1, errors.length);
            AnalyzerError.match(errors[0], 
                { RedundantCatchAllArgument: errorInfo => assert.ok(true) }, 
                () => assert.fail('Expected analyzer error of union case UnionCaseHandledButNotDeclared')
            );
        }); 

        it("returns errors from imported union declarations", function() {
            const types = [
                "import { union } from 'tagmeme';",
                "export const Result = union([ 'Ok', 'Error' ]);"
            ];  
            
            const code = [ 
                "import { Result } from './types'",
                "const success = Result.Ok(1);",
                // Error => handling too many cases, the 'Other' case in not declared in the `Result`
                "const value = Result.match(success, { Ok: n => n + 1, Error: () => 1, Other: () => 3 })"
            ];

            const mockReader = filename => {
                if (filename.indexOf("code") !== -1 && filename.indexOf("types") === -1) {
                    return code.join("\n");
                } else {
                    return types.join("\n");
                }
            };


            const errors = analyzer.analyze("cwd", "./code", mockReader);
            assert.equal(1, errors.length);
            AnalyzerError.match(errors[0], { 
                UnionCaseHandledButNotDeclared: errorInfo => {
                    assert.equal('Result', errorInfo.usedUnionType);
                    assert.equal('Other', errorInfo.usedUnionCase);
                }
            }, () => assert.fail('Expected analyzer error of union case UnionCaseHandledButNotDeclared'));
        });
    });

    describe("logErrorAndExit()", function() {
        it("Exits process with exit code 0 when there are no errors", function() {
            const errors = [ ];
            const mockProccess = { exit: n => assert.equal(0, n) };
            const logs = [ ];
            const logger = log => logs.push(log); 
            analyzer.logErrorsAndExit(errors, logger, mockProccess);
        }); 

        it("Exits process with exit code 1 when there are errors", function() {
            
            const code = [ 
                "import { union as makeUnion } from 'tagmeme';",
                "const Result = makeUnion([ 'Ok', 'Error' ]);",
                "const success = Result.Ok(1);",
                // Error => catchAll (2nd arg) is redundant
                "const value = Result.match(success, { Ok: n => n + 1, Error: () => 1 }, () => 0)"
            ];

            const mockReader = filename => code.join("\n");
            const errors = analyzer.analyze("cwd", "./irrelevant-filename", mockReader);
            assert.equal(1, errors.length);
            const mockProccess = { exit: n => assert.equal(1, n) };
            const logs = [ ];
            const logger = log => logs.push(log); 
            analyzer.logErrorsAndExit(errors, logger, mockProccess);
        }); 

    });
});