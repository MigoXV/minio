//go:build ignore
// +build ignore

// Copyright (c) 2015-2021 MinIO, Inc.
//
// This file is part of MinIO Object Storage stack
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

package main

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func genLDFlags(version string) string {
	releaseTag, date := releaseTag(version)
	copyrightYear := strconv.Itoa(date.Year())
	commit := commitID()
	ldflagsStr := "-s -w"
	ldflagsStr += " -X github.com/minio/minio/cmd.Version=" + version
	ldflagsStr += " -X github.com/minio/minio/cmd.CopyrightYear=" + copyrightYear
	ldflagsStr += " -X github.com/minio/minio/cmd.ReleaseTag=" + releaseTag
	ldflagsStr += " -X github.com/minio/minio/cmd.CommitID=" + commit
	ldflagsStr += " -X github.com/minio/minio/cmd.ShortCommitID=" + commit[:12]
	ldflagsStr += " -X github.com/minio/minio/cmd.GOPATH=" + os.Getenv("GOPATH")
	ldflagsStr += " -X github.com/minio/minio/cmd.GOROOT=" + os.Getenv("GOROOT")
	return ldflagsStr
}

// genReleaseTag prints release tag to the console for easy git tagging.
func releaseTag(version string) (string, time.Time) {
	relPrefix := "DEVELOPMENT"
	if prefix := os.Getenv("MINIO_RELEASE"); prefix != "" {
		relPrefix = prefix
	}

	relSuffix := ""
	if hotfix := os.Getenv("MINIO_HOTFIX"); hotfix != "" {
		relSuffix = hotfix
	}

	relTag := strings.Replace(version, " ", "-", -1)
	relTag = strings.Replace(relTag, ":", "-", -1)
	t, err := time.Parse("2006-01-02T15-04-05Z", relTag)
	if err != nil {
		panic(err)
	}
	relTag = strings.Replace(relTag, ",", "", -1)
	relTag = relPrefix + "." + relTag
	if relSuffix != "" {
		relTag += "." + relSuffix
	}

	return relTag, t
}

// commitID returns the source revision, including for archives without Git metadata.
func commitID() string {
	if revision := os.Getenv("MINIO_BUILD_REVISION"); revision != "" {
		if !regexp.MustCompile(`^([0-9a-f]{40}|[0-9a-f]{64})$`).MatchString(revision) {
			fmt.Fprintln(os.Stderr, "MINIO_BUILD_REVISION must be a full Git commit hash")
			os.Exit(1)
		}
		return revision
	}
	// git log --format="%H" -n1
	var (
		commit []byte
		err    error
	)
	cmdName := "git"
	cmdArgs := []string{"log", "--format=%H", "-n1"}
	if commit, err = exec.Command(cmdName, cmdArgs...).Output(); err != nil {
		fmt.Fprintln(os.Stderr, "Error generating git commit-id: ", err)
		os.Exit(1)
	}

	return strings.TrimSpace(string(commit))
}

func commitTime() time.Time {
	date := os.Getenv("MINIO_BUILD_COMMIT_TIME")
	if date == "" {
		output, err := exec.Command("git", "log", "--format=%cI", "-n1").Output()
		if err != nil {
			fmt.Fprintln(os.Stderr, "Error generating git commit-time: ", err)
			os.Exit(1)
		}
		date = strings.TrimSpace(string(output))
	}

	t, err := time.Parse(time.RFC3339, date)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error generating git commit-time: ", err)
		os.Exit(1)
	}

	return t.UTC()
}

func main() {
	var version string
	if len(os.Args) > 1 {
		version = os.Args[1]
	} else {
		version = commitTime().Format(time.RFC3339)
	}

	fmt.Println(genLDFlags(version))
}
