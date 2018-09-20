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

    describe("findUnionDeclarations()", function() {

        it("finds declarations constructed using 'union'", function() {
            
            const code = [ 
                "import { union } from 'tagmeme'",
                "const Option = union([ 'Some', 'None' ])"
            ];

            const ast = babelParser.parse(code.join("\n"), { sourceType: "module" });
            const unionImports = analyzer.findImports(ast.program.body);
            const declarations = analyzer.findUnionDeclarations(ast.program.body, unionImports);
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
            const unionImports = analyzer.findImports(ast.program.body);
            const declarations = analyzer.findUnionDeclarations(ast.program.body, unionImports);
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
            const unionImports = analyzer.findImports(ast.program.body);
            const declarations = analyzer.findUnionDeclarations(ast.program.body, unionImports);
            assert.equal(2, declarations.length);
            assert.equal("Option", declarations[0].unionType);
            assert.deepEqual([ 'Some', 'None' ], declarations[0].cases);
            assert.equal("Result", declarations[1].unionType);
            assert.deepEqual([ 'Ok', 'Error' ], declarations[1].cases);
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
            const errors = analyzer.analyze("./irrelevant-filename", mockReader);
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
            const errors = analyzer.analyze("./irrelevant-filename", mockReader);
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
            const errors = analyzer.analyze("./irrelevant-filename", mockReader);
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
            const errors = analyzer.analyze("./irrelevant-filename", mockReader);
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
            const errors = analyzer.analyze("./irrelevant-filename", mockReader);
            assert.equal(1, errors.length);
            AnalyzerError.match(errors[0], { 
                UnionCaseHandledButNotDeclared: errorInfo => {
                    assert.equal('Result', errorInfo.usedUnionType);
                    assert.equal('Other', errorInfo.usedUnionCase);
                }
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
            const errors = analyzer.analyze("./irrelevant-filename", mockReader);
            assert.equal(1, errors.length);
            AnalyzerError.match(errors[0], 
                { RedundantCatchAllArgument: errorInfo => assert.ok(true) }, 
                () => assert.fail('Expected analyzer error of union case UnionCaseHandledButNotDeclared')
            );
        }); 
    });
});