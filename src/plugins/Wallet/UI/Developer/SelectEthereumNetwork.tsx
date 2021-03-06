import React from 'react'
import Card from '@material-ui/core/Card'
import CardContent from '@material-ui/core/CardContent'
import { currentEthereumNetworkSettings } from '../../network'
import { Box } from '@material-ui/core'
import { EthereumNetwork } from '../../database/types'
import { SettingsUIEnum } from '../../../../components/shared-settings/useSettingsUI'

export function SelectEthereumNetwork() {
    return (
        <Card>
            <CardContent>
                <Box display="flex" alignItems="center">
                    <SettingsUIEnum enumObject={EthereumNetwork} value={currentEthereumNetworkSettings} />
                </Box>
            </CardContent>
        </Card>
    )
}
