import { AtLeastOneOf, isFunction } from '@codemucker/ts-lang'
import { popContext, pushContext } from '@codemucker/ts-logging'

type TestFunc = () => Promise<any> | void
type StepType = 'Given' | 'When' | 'Then' | 'AndGiven' | 'AndWhen' | 'AndThen'
type JestDone = (error?: any) => void

const realConsoleLog = console.log

function log(...data: any[]) {
  realConsoleLog(...data)
}

let currentScenario: ScenarioImp | undefined // = new ScenarioImp("scenario not set", () => {});

/**
 * Just a warpper around a describe for now
 *
 * @param label
 * @param featureBody
 */
export function Feature(label: string, featureBody: TestFunc) {
  describe(`Feature '${label}'`, () => {
    featureBody()
  })
}

const emptyTestFunc = () => {
  return
}
/**
 * Just wraps a jest test, internally running steps asynchroniusly and notifying the Jest test when
 * it has completed
 *
 * @param label
 * @param scenarioBodyOrConfig - if a set of config options, then expect the next arg to be the scenario body
 * @param scenarioBody
 *
 */
export function Scenario(
  label: string,
  scenarioBodyOrConfig: TestFunc | AtLeastOneOf<ScenarioConfig>,
  scenarioBody?: TestFunc
): void {
  const actualScenarioBody = isFunction(scenarioBodyOrConfig)
    ? scenarioBodyOrConfig
    : scenarioBody || emptyTestFunc
  const scenarioCfg = isFunction(scenarioBodyOrConfig)
    ? { pending: false }
    : scenarioBodyOrConfig
  const pending = scenarioCfg.pending == true

  if (pending) {
    test.skip(`PENDING Scenario '${label}'`, emptyTestFunc)
  } else {
    test(`Scenario '${label}'`, async (jestDone: JestDone) => {
      currentScenario = new ScenarioImp(
        label,
        actualScenarioBody,
        jestDone,
        scenarioCfg
      )
      await currentScenario.run()
    })
  }
}

export function Given(label: string, stepBody: TestFunc): Step {
  return addStep('Given', label, stepBody)
}

export function When(label: string, stepBody: TestFunc): Step {
  return addStep('When', label, stepBody)
}

export function Then(label: string, stepBody: TestFunc): Step {
  return addStep('Then', label, stepBody)
}

export function And(label: string, stepBody: TestFunc): Step {
  const currentStep = getScenarioOrFail().currentRunningStep
  if (!currentStep) {
    throw `An 'And' step requires a parent Given/When/Then , but none was supplied`
  }
  switch (currentStep.type) {
    case 'Given':
    case 'AndGiven':
      return addStep('AndGiven', label, stepBody)
    case 'When':
    case 'AndWhen':
      return addStep('AndWhen', label, stepBody)
    case 'Then':
    case 'AndThen':
      return addStep('AndThen', label, stepBody)
  }
}

export function addStep(
  stepType: StepType,
  stepLabel: string,
  stepBody: TestFunc
): Step {
  return getScenarioOrFail().addStep(stepType, stepLabel, stepBody)
}

function getScenarioOrFail(): ScenarioImp {
  if (currentScenario) {
    return currentScenario
  }
  throw `No Scenario. Ensure that a call is made to 'Scenario(...)' before adding a Given/When/Then`
}

type ScenarioConfig = {
  /**
   * Print steps and result to console on scenario completion
   */
  logOnComplete: boolean
  /**
   * Capture any console output when running a step
   */
  captureConsole: boolean
  /**
   * If enabled, print debug log statements to the console
   */
  debugEnabled: boolean
  /**
   * If enabled, when a failure occurs run the debugger
   */
  debugOnError: boolean
  /**
   * If the scenario is pending then the steps are not run and it's marked as skipped in Jest
   */
  pending: boolean
}

let scenarioCount = 0

function newScenarioId() {
  return `Sce.${scenarioCount++}`
}

class ScenarioImp {
  currentRunningStep: StepImp | undefined = undefined

  steps: StepImp[] = []
  stepPos = 0
  id = newScenarioId()

  public readonly cfg: ScenarioConfig

  private originalConsoleLog: any
  private capturedConsoleLog: any[] = []

  constructor(
    public readonly label: string,
    private readonly scenarioBody: TestFunc,
    private readonly jestDone: JestDone,
    cfg: Partial<ScenarioConfig> = {}
  ) {
    this.originalConsoleLog = console.log
    this.cfg = {
      ...({
        logOnComplete: false,
        captureConsole: true,
        debugEnabled: false,
        debugOnError: false,
      } as ScenarioConfig),
      ...cfg,
    }
  }

  get desc() {
    return `Scenario ${this.label} (${this.id})`
  }

  addStep(stepType: StepType, stepLabel: string, stepBody: TestFunc): StepImp {
    //console.log(`new step --- '${stepType} ${stepLabel}'`);
    const depth = this.currentRunningStep
      ? this.currentRunningStep.depth + 1
      : 0
    const id = this.currentRunningStep
      ? `${this.currentRunningStep.id}.${
          this.currentRunningStep.steps.length + 1
        }`
      : `${this.steps.length + 1}`
    const step = new StepImp(
      stepType,
      stepLabel,
      depth,
      id,
      stepBody,
      this,
      this.currentRunningStep
    )

    // console.log(
    //   `step.created`,
    //   {
    //     scenario: this.label,
    //     step: `${step.type} ${step.label}`,
    //     runningStep: this.currentRunningStep?.label,
    //   },
    // );

    if (this.currentRunningStep) {
      this.currentRunningStep.addChildStep(step)
    } else {
      this.steps.push(step)
    }

    return step
  }

  async run() {
    this.captureConsoleLog()
    this.debug(`Scenario ${this.label}`)
    const ctxt = this.id

    pushContext(ctxt)

    try {
      await this.scenarioBody()
      await this.nextStepOrFinish()
    } catch (err) {
      if (this.cfg.debugOnError) {
        debugger
      }
      this.scenarioFinished(err)
    } finally {
      popContext(ctxt)
    }
  }

  async nextStepOrFinish() {
    //if more scenario level steps run, those, else we're done
    if (this.stepPos < this.steps.length) {
      const nextStep = this.steps[this.stepPos]
      this.stepPos++
      this.debug(
        `next step (pending) --- step '${this.label}' => next step '${nextStep.label}'`
      )
      await nextStep.run()
    } else {
      this.scenarioFinished()
    }
  }

  stepRunning(step: StepImp) {
    this.debug(`Step started`, `'${step.desc}'`)
    this.currentRunningStep = step
  }

  async stepFinished(step: StepImp) {
    this.debug(`Step finished`, `'${step.desc}'`, { passed: step.passed })
    this.currentRunningStep = undefined
    if (step.passed) {
      await step.nextStep()
    } else {
      //fail scenario (for now. We might allow failures for certain steps)
      await this.scenarioFinished(step.error)
    }
  }

  private async scenarioFinished(error?: any) {
    this.resetConsoleLogCapture()
    const failed = error != undefined
    this.debug('Scenario finished', { desc: this.desc, error: error })

    if (this.cfg.logOnComplete || failed) {
      this.logResult(error)
    }

    currentScenario = undefined
    this.jestDone(error)
  }

  private logResult(error: any) {
    const failed = error != undefined
    const result = failed ? 'FAILED' : 'PASSED'
    // const messages = [
    //   `Scenario '${this.label}' ${result}`,
    //   ...this.stepLog.map((item) => `  ${item}`),
    // ];
    //const logs: string[] = [];

    log(`Scenario '${this.label}' ${result} [${this.id}]`)

    if (failed) {
      for (const args of this.capturedConsoleLog) {
        log(` [log] ${args[0]}`, ...args.slice(1))
      }
    }
    const printSteps = (steps: StepImp[]) => {
      for (const step of steps) {
        let stepStatus = ''
        if (step.type.startsWith('Then') || step.type.startsWith('When')) {
          stepStatus = step.complete
            ? step.passed
              ? ' [PASSED]'
              : ' [FAILED]'
            : ' [NOT RUN]'
        }
        if (!step.complete) {
          stepStatus = ' [NOT RUN]'
        }
        const padding = padLeft(step.depth, '  ')
        log(`${padding}${step.id}. ${step.fullLabel}${stepStatus}`)
        if (failed) {
          for (const args of step.capturedLog) {
            log(`${padding}  [log] ${args[0]}`, ...args.slice(1))
          }
        }
        printSteps(step.steps)
      }
    }

    printSteps(this.steps)

    if (error) {
      log('Scenario error:', { error })
    }
  }

  private captureConsoleLog() {
    if (!this.cfg.captureConsole) {
      return
    }
    console.log = (...data: any[]) => {
      if (this.currentRunningStep) {
        this.currentRunningStep.capturedLog.push(data)
      } else {
        this.capturedConsoleLog.push(data)
      }
    }
  }

  private resetConsoleLogCapture() {
    if (this.cfg.captureConsole) {
      console.log = this.originalConsoleLog
    }
  }

  private debug(...data: any[]) {
    if (this.cfg.debugEnabled) {
      log('[Scenario DEBUG]', ...data)
    }
  }
}

export interface Step {
  complete: boolean
  error?: any
  passed: boolean
  failed: boolean
  fullLabel: string
  desc: string
}

class StepImp implements Step {
  readonly steps: StepImp[] = []
  stepPos = 0

  complete = false
  error: any = undefined
  capturedLog: any[] = []

  constructor(
    public readonly type: StepType,
    public readonly label: String,
    public readonly depth: number,
    public readonly id: string,
    public readonly stepBody: TestFunc,
    public readonly scenario: ScenarioImp,
    public readonly parent?: StepImp
  ) {}

  get passed() {
    return this.error == undefined
  }

  get failed() {
    return !this.passed
  }

  get fullLabel() {
    return this.type.replace('And', 'And ') + ' ' + this.label
  }

  get desc() {
    const padding = padLeft(this.depth, '  ')
    return `${padding}${this.id}. ${this.type} ${this.label}`
  }

  addChildStep(step: StepImp) {
    //console.log(`add step --- '${step.label}' to '${this.label}'`);
    this.steps.push(step)
  }

  async run() {
    this.scenario.stepRunning(this)
    await this.runBody()
  }

  private async runBody() {
    try {
      await this.stepBody()
    } catch (err) {
      if (this.scenario.cfg.debugOnError) {
        debugger
      }
      this.error = err
    } finally {
      await this.finished()
    }
  }

  private async finished() {
    this.complete = true
    await this.scenario.stepFinished(this)
  }

  async nextStep() {
    const hasMoreSiblingSteps = this.stepPos < this.steps.length
    if (hasMoreSiblingSteps) {
      // run the next sibling step
      const nextStep = this.steps[this.stepPos]
      this.stepPos++
      await nextStep.run()
    } else if (this.parent) {
      //no more siblings, defer to the parent step to run it's next step
      await this.parent.nextStep()
    } else {
      //let the scenario handle what to do next
      await this.scenario.nextStepOrFinish()
    }
  }
}

function padLeft(padLength: number, padChar = ' ') {
  return new Array(1 + padLength).join(padChar)
}
