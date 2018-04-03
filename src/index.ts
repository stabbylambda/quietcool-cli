#!/usr/bin/env node
import * as _ from "lodash";
import { Observable } from "rxjs";
import * as dotenv from "dotenv";
import * as fanControl from "quietcool";
import Enquirer from "enquirer";
import promptList from "prompt-list";

const config = dotenv.config();
const enquirer = new Enquirer();
enquirer.register("list", promptList);

type Fan = fanControl.FanDetails;

enum Action {
  Quit = "Quit",
  Refresh = "Refresh"
}

interface Answer<T> {
  answer: T;
}

function ask<T>(details): Observable<Answer<T>> {
  return Observable.from<Answer<T>>(
    enquirer.ask([
      {
        ...details,
        name: "answer"
      }
    ])
  );
}

enum CurrentSpeed {
  High = 3,
  Medium = 2,
  Low = 1
}

enum Power {
  On = 1,
  Off = 0
}
const sequences = { 0: 3, 1: 2, 4: 1 };
const formatFanName = (fan: Fan): string => {
  const speedCount = sequences[fan.status.sequence];
  let onOff = Power[fan.info.status];
  let currentSpeed = CurrentSpeed[fan.status.speed];
  return `${fan.info.name} ${onOff} ${currentSpeed} ${speedCount} (${
    fan.id.uid
  })`;
};

interface Fans {
  [key: string]: Fan;
}

const getFanDictionary = (ip: string): Observable<Fans> =>
  fanControl.listFansWithInfo(ip).reduce((acc: Fans, fan) => {
    acc[fan.id.uid] = fan;
    return acc;
  }, {});

const mainMenu = (ip: string): Observable<Fan | Action> =>
  getFanDictionary(ip).flatMap(fans => {
    let fanChoices = _.map(fans, formatFanName);
    let choices = [...fanChoices, enquirer.separator(), "Refresh", "Quit"];

    return ask<Fan | Action>({
      type: "list",
      message: "Here are your fans",
      choices,
      transform: answer => {
        if (answer == Action.Refresh || answer == Action.Quit) {
          return answer;
        }
        let fan = _.find(fans, x => answer === formatFanName(x));
        return fan || Action.Refresh;
      }
    }).map(x => x.answer);
  });

interface ConfigAnswers {
  configOption: string;
  fanName: string;
  fanSpeeds: string;
}
enum ConfigureAnswer {
  UpdateName = "Update Name",
  UpdateSpeeds = "Update Speeds"
}

enum Speeds {
  High = "3",
  Medium = "2",
  Low = "1"
}
const setCurrentSpeed = (fan: Fan) =>
  ask<Speeds>({
    type: "list",
    message: `What speed for ${fan.info.name}`,
    choices: ["High", "Medium", "Low"]
  }).flatMap(x => fanControl.setCurrentSpeed(fan.id, Speeds[x.answer]));

function isFan(x: Action | Fan): x is Fan {
  return (<Fan>x).id !== undefined;
}

enum FanAction {
  TurnOn = "Turn On",
  TurnOff = "Turn Off",
  SetCurrentSpeed = "Set Current Speed",
  UpdateName = "Update Name",
  UpdateSpeeds = "Update Speeds",
  BackToMenu = "Back To Menu"
}

interface FanMenuAnswer {
  fan: Fan;
  action: FanAction;
}

const fanMenu = (fan: Fan): Observable<FanMenuAnswer> =>
  ask<FanAction>({
    type: "list",
    message: "What do you want to do?",
    choices: [
      FanAction.TurnOn,
      FanAction.TurnOff,
      FanAction.SetCurrentSpeed,
      FanAction.UpdateName,
      FanAction.UpdateSpeeds,
      FanAction.BackToMenu
    ]
  }).map(x => ({ fan, action: x.answer }));

const updateName = (fan: Fan) =>
  ask<string>({
    type: "input",
    message: "What is the new name?"
  }).flatMap(x => fanControl.updateFanName(fan.id, x.answer));

const updateSpeeds = (fan: Fan) =>
  ask<string>({
    type: "list",
    message: "How many speeds does this fan have?",
      choices: ["3", "2", "1"]
  }).flatMap(x => fanControl.updateFanSpeeds(fan.id, x.answer));

const program = (ip: string): Observable<any> => {
  return mainMenu(ip)
    .takeWhile(x => isFan(x) || x === Action.Refresh)
    .flatMap(x => (isFan(x) ? fanMenu(x) : program(ip)))
    .flatMap<FanMenuAnswer, any>(({ fan, action }) => {
      let id = fan.id;

      switch (action) {
        case FanAction.TurnOn:
          return fanControl.turnFanOn(fan.id);
        case FanAction.TurnOff:
          return fanControl.turnFanOff(fan.id);
        case FanAction.UpdateName:
          return updateName(fan);
        case FanAction.UpdateSpeeds:
          return updateSpeeds(fan);
        case FanAction.SetCurrentSpeed:
          return setCurrentSpeed(fan);
        default:
          return Observable.of({});
      }
    })
    .flatMap(x => program(ip));
};

let ip = process.env.CONTROLLER_IP;
if (!ip) {
  console.log("The environment variable CONTROLLER_IP was not set");
} else {
  program(ip).subscribe(
    fans => console.log(fans),
    err => console.log(err),
    () => console.log("completed")
  );
}
