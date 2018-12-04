// Copyright 2018 The Bazel Authors. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

import { BazelQuery, QueryResult } from "../bazel/query"
import { BazelTest, BazelBuild, BazelCommandAdapter, BazelCommandArgs } from "../bazel/commands";

/**
 * Command adapter to pass arguments to Bazel Commands
 */
class CodeLensCommandAdapter implements BazelCommandAdapter {
  // Working directory to execute Bazel from
  workingDirectory: string;
  // Other command line arguments to pass to Bazel
  options: string[];
  /**
   *
   * @param workingDirectory Working directory to execute Bazel from
   * @param options Other command line arguments to pass to Bazel
   */
  public constructor(
    workingDirectory: string,
    options: string[] = []
  ) {
    this.workingDirectory = workingDirectory;
    this.options = options;
  }

  getBazelCommandArgs(): BazelCommandArgs {
    return { "workingDirectory": this.workingDirectory, "options": this.options };
  }
}

/**
 * Search for the path to the directory that has the Bazel WORKSPACE file for the given file.
 * Returns the path to the directory with the Bazel WORKSPACE if found. Returns undefined otherwise.
 * If multiple directories along the path to the file has files called "WORKSPACE", the lowest path
 * is returned.
 * @param fsPath Path to a file in a Bazel workspace
 */
function getBazelWorkspaceFolder(fsPath: string): string | undefined {
  var basename, dirname: string
  do {
    // The last element in the path
    basename = path.basename(fsPath);
    // The directory containing "b"
    dirname = path.dirname(fsPath);

    // Potential WORKSPACE path
    let workspace = path.join(dirname, "WORKSPACE");
    try {
      fs.accessSync(workspace, fs.constants.F_OK);
      // WORKSPACE file is accessible. We have found the Bazel workspace directory
      return dirname;
    } catch (err) {
    }
    fsPath = dirname;
  } while (dirname !== "");

  return undefined;
}

/** vscode.CodeLensProvider for Bazel BUILD files **/
export class BazelBuildCodeLensProvider implements vscode.CodeLensProvider {

  /**
   * Takes the result of a Bazel query for targets defined in a package and returns a list of
   * CodeLens for the BUILD file in that package
   * @param bazelWorkspaceDirectory The bazel workspace directory
   * @param queryResult Result of the bazel query requesting targets in a package
   */
  addCodeLens(bazelWorkspaceDirectory: string, queryResult: QueryResult): vscode.CodeLens[] {
    let result = [];

    for (const rule of queryResult.rules) {
      // Source location in the BUILD file for this target
      let loc = rule.location;
      // Fully qualified name of the target
      let target = rule.name;
      let rc = rule.ruleClass;
      var cmd: vscode.Command;
      if (rc.endsWith("_test")) {
        cmd = {
          title: `Test ${target}`,
          command: "bazel.testTarget",
          arguments: [new CodeLensCommandAdapter(bazelWorkspaceDirectory, [target])],
          tooltip: `Build ${target}`
        }
      } else {
        cmd = {
          title: `Build ${target}`,
          command: "bazel.buildTarget",
          arguments: [new CodeLensCommandAdapter(bazelWorkspaceDirectory, [target])],
          tooltip: `Build ${target}`
        }
      }
      result.push(new vscode.CodeLens(loc.range, cmd));
    }

    return result;
  }

  /**
   * Provides promisified CodeLen(s) for the given document.
   * @param document A Bazel BUILD file
   * @param token CodeLens token automatically generated by VS Code when invoking the provider
   */
  async provideCodeLenses(document: vscode.TextDocument,
    token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    let workspace = getBazelWorkspaceFolder(document.uri.fsPath);
    if (workspace === undefined) {
      vscode.window.showWarningMessage(
        "Bazel BUILD CodeLens unavailable as currently opened file is not in a Bazel workspace");
      return [];
    }
    // Path to the BUILD file relative to the workspace
    let relPathToDoc = path.relative(workspace, document.uri.fsPath);
    // Strip away the name of the BUILD file from the relative path
    let relDirWithDoc = path.dirname(relPathToDoc);
    // Strip away the "." if the BUILD file was in the same directory as the workspace
    if (relDirWithDoc === ".") {
      relDirWithDoc = "";
    }
    // Turn the relative path into a package label
    let pkg = `//${relDirWithDoc}`;
    let queryResult = await new BazelQuery(workspace,
      `'kind(rule, ${pkg}:all)'`, []).runAndParse();
    return this.addCodeLens(workspace, queryResult);
  }
}