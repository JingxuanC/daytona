// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package mcp

import (
	"github.com/spf13/cobra"
)

var MCPCmd = &cobra.Command{
	Use:   "mcp",
	Short: "Manage Roost MCP Server",
	Long:  "Commands for managing Roost MCP Server",
}

func init() {
	MCPCmd.AddCommand(InitCmd)
	MCPCmd.AddCommand(StartCmd)
	MCPCmd.AddCommand(ConfigCmd)
}
