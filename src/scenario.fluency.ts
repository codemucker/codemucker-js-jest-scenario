/**
 * TODO: need to ensure the stack trace correctly get the right line number asnd position
 * from the error for determining the step label
 * This module adds the ability to auto extract the step labels for a more fluent experience
 */

import { isFunction, isString } from '@codemucker/ts-lang'
import {
  And as RealAnd,
  Given as RealGiven,
  Scenario,
  Then as RealThen,
  When as RealWhen,
} from './scenario'

// require("source-map-support").install({
//   environment: "node",
// });

export { Scenario }

const realConsoleLog = console.log

function log(...data: any[]) {
  realConsoleLog(...data)
}
type TestFunc = () => Promise<any> | void
type StepBody = TestFunc | Promise<any>

export function Given(labelOrStep: string | StepBody, stepBody?: StepBody) {
  const details = extractStepDetails(labelOrStep, stepBody)
  return RealGiven(details.label, details.stepBody)
}

export function When(labelOrStep: string | StepBody, stepBody?: StepBody) {
  const details = extractStepDetails(labelOrStep, stepBody)
  return RealWhen(details.label, details.stepBody)
}

export function Then(labelOrStep: string | StepBody, stepBody?: StepBody) {
  const details = extractStepDetails(labelOrStep, stepBody)
  return RealThen(details.label, details.stepBody)
}

export function And(labelOrStep: string | StepBody, stepBody?: StepBody) {
  const details = extractStepDetails(labelOrStep, stepBody)
  return RealAnd(details.label, details.stepBody)
}

function extractStepDetails(
  labelOrStep: string | StepBody,
  stepBody?: StepBody
): { label: string; stepBody: TestFunc } {
  // log("extractStepDetails", {
  //   stepBody,
  //   isFunction: isFunction(stepBody),
  //   "isX": Object.prototype.toString.call(stepBody),
  // });
  let label: string
  let realStepBody: TestFunc
  if (isString(labelOrStep)) {
    log('label is string')
    label = labelOrStep
    realStepBody = stepBody
      ? isFunction(stepBody)
        ? stepBody
        : () => stepBody
      : emptyFunction
  } else if (isFunction(labelOrStep)) {
    log('label is FUNC')
    label = extractFunctionNameOrDocString(labelOrStep)
    realStepBody = labelOrStep
  } else {
    //is promise
    log('label is Promise')
    log('labelOrStep=', { labelOrStep: labelOrStep.toString() })
    label = extractLabelFromSource(2) || '?'
    realStepBody = async () => await labelOrStep
  }
  log('extractStepDetails DONE', { label, stepBody: realStepBody })
  return { label, stepBody: realStepBody }
}

function emptyFunction() {
  return
}

function extractFunctionNameOrDocString(func?: Function) {
  if (!func) {
    return ''
  }
  let name = func.name
  if (name && name != '') {
    return name
  }
  name = extractFunctionDocs(func, 2) || ''
  return name
}

/**
 * Given a function, extract the embedded 'doc string'. E.g.
 *
 * function myFunc(){
 *    "This function is here as an exampple, and this is a
 *     docstring. It can start with single, double, or back quote and be multipe lines"
 * }
 */
export function extractFunctionDocs(
  func: Function,
  maxLinesToRead = 4
): string | undefined {
  'Extracts lines like this from functions'
  if (!func) {
    return undefined
  }
  const srcLines = func.toString().split(/\r?\n/)
  const commentDelims = '\'"`'
  for (var i = 0; i < srcLines.length && i < maxLinesToRead; i++) {
    const line = srcLines[i].trim()
    if (line.length == 0) {
      continue
    }
    const startChar = line[0]
    const isBeginComment = commentDelims.indexOf(startChar) != -1
    if (isBeginComment) {
      const startIdx = i
      let endIdx = -1
      for (var j = i; j < srcLines.length; j++) {
        const line = srcLines[j].trim()
        if (line.endsWith(`${startChar};`) || line.endsWith(startChar)) {
          //done, found end of comments
          endIdx = j

          let docs = srcLines
            .slice(startIdx, endIdx + 1)
            .join('\n')
            .trim()
          if (docs.endsWith(';')) {
            docs = docs.substr(0, docs.length - 1)
          }
          docs = docs.substr(1, docs.length - 2)
          return docs
        }
      }
      return undefined
    }
  }
  return undefined
}
// originally from https://stackoverflow.com/questions/38194457/how-to-get-actual-line-within-source-for-custom-logging-in-typescript

/**
 * Extracts the calling code line
 * {@link https://github.com/evanw/node-source-map-support usable by typescript node-source-map-support module}
 * {@link https://github.com/mozilla/source-map/ Mozilla source-map library & project}
 * {@link http://www.html5rocks.com/en/tutorials/developertools/sourcemaps/ good introduction to sourcemaps}
 */
export function extractLabelFromSource(
  skipStacksFrames = 0
): string | undefined {
  log('EXTRACT LABEL FROM SOURCE ')
  const stack = new Error().stack
  if (!stack) {
    return undefined
  }
  /**
   * go one line back for the caller
   * @type {string}
   */
  let stackLine = stack.split('\n')[skipStacksFrames + 2]
  log('Extracted stack', { stackLine, stack, skipStacksFrames })
  /**
   * retrieve the file basename & positional data, after the last `/` to the `)`
   */
  //
  let caller_line = stackLine.slice(
    stackLine.lastIndexOf('/'),
    stackLine.lastIndexOf(')')
  )
  /**
   *  test for no `/` ; if there is no `/` then use filename without a prefixed path
   */
  if (caller_line.length == 0) {
    caller_line = stackLine.slice(
      stackLine.lastIndexOf('('),
      stackLine.lastIndexOf(')')
    )
  }
  //
  /**
   * filename_base - parse out the file basename; remove first `/` char and go to `:`
   */
  let filename_base = caller_line.slice(0 + 1, caller_line.indexOf(':'))
  /**
   * line_no - parse out the line number ; remove first `:` char and go to 2nd `:`
   */
  let line_no = caller_line.slice(
    caller_line.indexOf(':') + 1,
    caller_line.lastIndexOf(':')
  )
  /**
   * line_pos - line positional - from the last `:` to the end of the string
   */
  let line_pos = caller_line.slice(caller_line.lastIndexOf(':') + 1)
  log(
    `extractLabel called by ${filename_base} on line# ${line_no} @ char# ${line_pos}`
  )
  //TODO:extract the function/promise name
  const label = caller_line
  return label
}
