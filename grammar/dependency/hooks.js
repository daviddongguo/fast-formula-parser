const LogicalFunctions = require('../../formulas/functions/logical');
const ReferenceFunctions = require('../../formulas/functions/reference');
const FormulaError = require('../../formulas/error');
const {FormulaHelpers} = require('../../formulas/helpers');
const {Parser} = require('../parsing');
const lexer = require('../lexing');
const Utils = require('./utils');

class DepParser {

    /**
     *
     * @param {{onVariable: Function}} [config]
     */
    constructor(config) {
        this.logs = [];
        this.data = [];
        this.utils = new Utils(this);
        config = Object.assign({
            onVariable: () => null,
        }, config);
        this.utils = new Utils(this);

        this.onVariable = config.onVariable;
        this.functions = Object.assign({}, ReferenceFunctions, LogicalFunctions);

        this.parser = new Parser(this, this.utils);
    }

    /**
     * Get value from the cell reference
     * @param ref
     * @return {*}
     */
    getCell(ref) {
        // console.log('get cell', JSON.stringify(ref));
        if (ref.row != null) {
            if (ref.sheet == null)
                ref.sheet = this.position ? this.position.sheet : undefined;
            const idx = this.data.findIndex(element => {
                return (element.from && element.from.row <= ref.row && element.to.row >= ref.row
                    && element.from.col <= ref.col && element.to.col >= ref.col)
                    || (element.row === ref.row && element.col === ref.col && element.sheet === ref.sheet)
            });
            if (idx === -1)
                this.data.push(ref);
        }
        return 0;
    }

    /**
     * Get values from the range reference.
     * @param ref
     * @return {*}
     */
    getRange(ref) {
        // console.log('get range', JSON.stringify(ref));
        if (ref.from.row != null) {
            if (ref.sheet == null)
                ref.sheet = this.position ? this.position.sheet : undefined;

            const idx = this.data.findIndex(element => {
                return element.from && element.from.row === ref.from.row && element.from.col === ref.from.col
                    && element.to.row === ref.to.row && element.to.col === ref.to.col;
            });
            if (idx === -1)
                this.data.push(ref);
        }
        return [[0]]
    }

    /**
     * TODO:
     * Get references or values from a user defined variable.
     * @param name
     * @return {*}
     */
    getVariable(name) {
        // console.log('get variable', name);
        const res = {ref: this.onVariable(name, this.position.sheet)};
        if (res.ref == null)
            return FormulaError.NAME;
        if (FormulaHelpers.isCellRef(res))
            this.getCell(res);
        else {
            this.getRange(res);
        }
        return res;
    }

    /**
     * Retrieve values from the given reference.
     * @param valueOrRef
     * @return {*}
     */
    retrieveRef(valueOrRef) {
        if (FormulaHelpers.isRangeRef(valueOrRef)) {
            return this.getRange(valueOrRef.ref);
        }
        if (FormulaHelpers.isCellRef(valueOrRef)) {
            return this.getCell(valueOrRef.ref)
        }
        return valueOrRef;
    }

    /**
     * The functions that can return a reference instead of a value as normal functions.
     * Note: Not all functions from "Lookup and reference" category can return a reference.
     * {@link https://support.office.com/en-ie/article/lookup-and-reference-functions-reference-8aa21a3a-b56a-4055-8257-3ec89df2b23e}
     * @param name - Reference function name.
     * @param args - Arguments that pass to the function.
     */
    callRefFunction(name, args) {
        args.forEach(arg => {
            this.retrieveRef(arg);
        });
        name = name.toUpperCase();
        if (this.functions[name]) {
            let res;
            try {
                res = (this.functions[name](this, ...args));
            } catch (e) {
                // allow functions throw FormulaError, this make functions easier to implement!
                if (e instanceof FormulaError) {
                    return e;
                } else {
                    throw e;
                }
            }
            if (res === undefined) {
                return {value: 0, ref: {}};
            }
            return FormulaHelpers.checkFunctionResult(res);
        } else {
            if (!this.logs.includes(name)) this.logs.push(name);
            // console.log(`Function ${name} is not implemented`);
            return {value: 0, ref: {}};
        }
    }

    /**
     * Call an excel function.
     * @param name - Function name.
     * @param args - Arguments that pass to the function.
     * @return {*}
     */
    callFunction(name, args) {
        args.forEach(arg => {
            if (arg === null)
                return;
            this.utils.extractRefValue(arg);
        });
        return {value: 0, ref: {}};
    }

    /**
     * Check and return the appropriate formula result.
     * @param result
     * @return {*}
     */
    checkFormulaResult(result) {
        const type = typeof result;
        if (type === 'object') {
            if (result.ref && result.ref.row && !result.ref.from) {
                // single cell reference
                result = this.retrieveRef(result);
            } else if (result.ref && result.ref.from && result.ref.from.col === result.ref.to.col) {
                // single Column reference
                result = this.retrieveRef({
                    ref: {
                        row: result.ref.from.row, col: result.ref.from.col
                    }
                });
            }
        }
        return result;
    }

    parse(inputText, position) {
        if (inputText.length === 0) throw Error('Input must not be empty.');
        this.data = [];
        this.position = position;
        const lexResult = lexer.lex(inputText);
        this.parser.input = lexResult.tokens;
        let res = this.parser.formulaWithCompareOp();
        this.checkFormulaResult(res);
        if (this.parser.errors.length > 0) {
            const error = this.parser.errors[0];
            const line = error.previousToken.startLine, column = error.previousToken.startColumn + 1;
            let msg = '\n' + inputText.split('\n')[line - 1] + '\n';
            msg += Array(column - 1).fill(' ').join('') + '^\n';
            error.message = msg + `Error at position ${line}:${column}\n` + error.message;
            console.error(error.toString())
        }
        return this.data;
    }
}

module.exports = {
    DepParser,
};
