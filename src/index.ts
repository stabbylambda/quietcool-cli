import * as _ from "lodash";
import { Observable } from "rxjs";
import * as dotenv from "dotenv";
import * as fanControl from "quietcool";
import Enquirer from "enquirer";
import promptList from "prompt-list";

const config = dotenv.config();
const enquirer = new Enquirer();
enquirer.register("list", promptList);

const sequences = { 0: 3, 1: 2, 4: 1 };
const formatFanName = ({ info, status }) => {
  const speedCount = sequences[status.sequence];
  const power = { "1": "ON", "0": "OFF" };
  const speeds = { 3: "High", 2: "Medium", 1: "Low" };
  let onOff = power[info.status];
  let currentSpeed = speeds[status.speed];
  return `${info.name} ${onOff} ${currentSpeed} ${speedCount} (${info.uid})`;
};

const mainMenu = ip => {
  return Observable.of(ip)
    .flatMap(ip => fanControl.listFans(ip))
    .flatMap(fans => {
      let fanCount = fans.length;
      console.log(`Found ${fanCount} fans`);
      return Observable.from(fans)
        .concatMap(fan => Observable.of(fan))
        .flatMap(fan => fanControl.getFanInfo(ip, fan.uid))
        .flatMap(info =>
          fanControl.getFanStatus(ip, info.uid).map(status => ({
            status,
            info
          }))
        )
        .take(fanCount)
        .reduce((acc, fan) => {
          acc[fan.info.uid] = fan;
          return acc;
        }, {});
    })
    .flatMap(fans => {
      let choices = _.map(fans, formatFanName);

      return enquirer.ask([
        {
          type: "list",
          name: "mainMenu",
          message: "Here are your fans",
          choices: [...choices, enquirer.separator(), "Refresh", "Quit"],
          transform: answer => {
            if (answer == "Refresh" || answer == "Quit") {
              return { type: "action", value: answer };
            }
            let fan = _.find(fans, x => answer === formatFanName(x));
            return { type: "fan", value: fan };
          }
        }
      ]);
    });
};

interface ConfigAnswers {
  configOption: string;
  fanName: string;
  fanSpeeds: string;
}
const configureMenu = (ip, answers) => {
  let uid = answers.mainMenu.value.info.uid;

  return Observable.from(
    enquirer.ask([
      {
        type: "list",
        name: "configOption",
        message: `Configure ${answers.mainMenu.value.info.name} (${
          sequences[answers.mainMenu.value.status.sequence]
        })`,
        choices: ["Update Name", "Update Speeds"]
      }
    ])
  )
    .flatMap<ConfigAnswers>(answers => {
      switch (answers.configOption) {
        case "Update Name":
          return Observable.from(
            enquirer.ask({
              type: "input",
              name: "fanName",
              message: "What is the new name?"
            })
          )
            .flatMap(name => fanControl.updateFanName(ip, uid, answers.fanName))
            .map(x => ({}));
        case "Update Speeds":
          return Observable.from(
            enquirer.ask({
              type: "list",
              name: "fanSpeeds",
              message: "How many speeds does this fan have?",
              choices: ["1", "2", "3"]
            })
          )
            .flatMap(name =>
              fanControl.updateFanSpeeds(ip, uid, answers.fanSpeeds)
            )
            .map(x => ({}));
        default:
          return Observable.of({});
      }
    })
    .flatMap(x => program(ip));
};
interface SpeedAnswers {
  setSpeed: string;
}
const speedMenu = (ip, answers) => {
  let uid = answers.mainMenu.value.info.uid;

  return Observable.from(
    enquirer.ask([
      {
        type: "list",
        name: "setSpeed",
        message: `What speed for ${answers.mainMenu.value.info.name}`,
        choices: ["High", "Medium", "Low"]
      }
    ])
  )
    .flatMap<SpeedAnswers>(answers => {
      switch (answers.setSpeed) {
        case "High":
          return fanControl.setCurrentSpeed(ip, uid, "3");
        case "Medium":
          return fanControl.setCurrentSpeed(ip, uid, "2");
        case "Low":
          return fanControl.setCurrentSpeed(ip, uid, "1");
      }
    })
    .flatMap(x => program(ip));
};

interface MainMenuAnswerType {
  type: string;
  value: string;
}
interface MainMenuAnswers {
  mainMenu: MainMenuAnswerType;
}

const program = ip => {
  return mainMenu(ip)
    .takeWhile<MainMenuAnswers>(answer => answer.mainMenu.value != "Quit")
    .flatMap<MainMenuAnswers>(({ mainMenu: { type, value } }) => {
      if (type == "action" && value == "Refresh") {
        return program(ip);
      } else {
        return enquirer.ask([
          {
            type: "list",
            name: "action",
            message: "What do you want to do?",
            choices: [
              "Turn On",
              "Turn Off",
              "Set Current Speed",
              "Configure",
              "Back To Menu"
            ]
          }
        ]);
      }
    })
    .flatMap(answers => {
      let uid = answers.mainMenu.value.info.uid;
      switch (answers.action) {
        case "Turn On":
          return fanControl.turnFanOn(ip, uid).flatMap(x => program(ip));
        case "Turn Off":
          return fanControl.turnFanOff(ip, uid).flatMap(x => program(ip));
        case "Configure":
          return configureMenu(ip, answers);
        case "Set Current Speed":
          return speedMenu(ip, answers);
        case "Back To Menu":
          return program(ip);
        default:
          return program(ip);
      }
    });
};

let ip = process.env.CONTROLLER_IP;
program(ip)
  .catch(err => {
    console.log("ERROR", err);
    program(ip);
  })
  .subscribe(
    fans => console.log(fans),
    err => console.log(err),
    () => console.log("completed")
  );
