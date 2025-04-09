import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GenericModal } from "../ui/GenericModal";
import { TextField, Typography, Box, Button, IconButton, InputAdornment } from "@mui/material";
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { modalStyle } from "../recorder/AddWhereCondModal";
import { useGlobalInfoStore } from '../../context/globalInfo';
import { getStoredRecording, updateRecording } from '../../api/storage';
import { WhereWhatPair } from 'maxun-core';

interface RobotMeta {
    name: string;
    id: string;
    createdAt: string;
    pairs: number;
    updatedAt: string;
    params: any[];
}

interface RobotWorkflow {
    workflow: WhereWhatPair[];
}

interface ScheduleConfig {
    runEvery: number;
    runEveryUnit: 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS' | 'MONTHS';
    startFrom: 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
    atTimeStart?: string;
    atTimeEnd?: string;
    timezone: string;
    lastRunAt?: Date;
    nextRunAt?: Date;
    cronExpression?: string;
}

export interface RobotSettings {
    id: string;
    userId?: number;
    recording_meta: RobotMeta;
    recording: RobotWorkflow;
    google_sheet_email?: string | null;
    google_sheet_name?: string | null;
    google_sheet_id?: string | null;
    google_access_token?: string | null;
    google_refresh_token?: string | null;
    schedule?: ScheduleConfig | null;
}

interface RobotSettingsProps {
    isOpen: boolean;
    handleStart: (settings: RobotSettings) => void;
    handleClose: () => void;
    initialSettings?: RobotSettings | null;
}

interface CredentialInfo {
    value: string;
    type: string;
}

interface Credentials {
    [key: string]: CredentialInfo;
}

interface CredentialVisibility {
    [key: string]: boolean;
}

interface GroupedCredentials {
    passwords: string[];
    emails: string[];
    usernames: string[];
    others: string[];
}

export const RobotEditModal = ({ isOpen, handleStart, handleClose, initialSettings }: RobotSettingsProps) => {
    const { t } = useTranslation();
    const [credentials, setCredentials] = useState<Credentials>({});
    const { recordingId, notify, setRerenderRobots } = useGlobalInfoStore();
    const [robot, setRobot] = useState<RobotSettings | null>(null);
    const [credentialGroups, setCredentialGroups] = useState<GroupedCredentials>({
        passwords: [],
        emails: [],
        usernames: [],
        others: []
    });
    const [showPasswords, setShowPasswords] = useState<CredentialVisibility>({});

    const isEmailPattern = (value: string): boolean => {
        return value.includes('@');
    };

    const isUsernameSelector = (selector: string): boolean => {
        return selector.toLowerCase().includes('username') ||
            selector.toLowerCase().includes('user') ||
            selector.toLowerCase().includes('email');
    };

    const determineCredentialType = (selector: string, info: CredentialInfo): 'password' | 'email' | 'username' | 'other' => {
        if (info.type === 'password' || selector.toLowerCase().includes('password')) {
            return 'password';
        }
        if (isEmailPattern(info.value) || selector.toLowerCase().includes('email')) {
            return 'email';
        }
        if (isUsernameSelector(selector)) {
            return 'username';
        }
        return 'other';
    };

    useEffect(() => {
        if (isOpen) {
            getRobot();
        }
    }, [isOpen]);

    useEffect(() => {
        if (robot?.recording?.workflow) {
            const extractedCredentials = extractInitialCredentials(robot.recording.workflow);
            setCredentials(extractedCredentials);
            setCredentialGroups(groupCredentialsByType(extractedCredentials));
        }
    }, [robot]);

    function extractInitialCredentials(workflow: any[]): Credentials {
        const credentials: Credentials = {};

        const isPrintableCharacter = (char: string): boolean => {
            return char.length === 1 && !!char.match(/^[\x20-\x7E]$/);
        };

        workflow.forEach(step => {
            if (!step.what) return;

            let currentSelector = '';
            let currentValue = '';
            let currentType = '';
            let i = 0;

            while (i < step.what.length) {
                const action = step.what[i];

                if (!action.action || !action.args?.[0]) {
                    i++;
                    continue;
                }

                const selector = action.args[0];

                // Handle full word type actions first
                if (action.action === 'type' &&
                    action.args?.length >= 2 &&
                    typeof action.args[1] === 'string' &&
                    action.args[1].length > 1) {

                    if (!credentials[selector]) {
                        credentials[selector] = {
                            value: action.args[1],
                            type: action.args[2] || 'text'
                        };
                    }
                    i++;
                    continue;
                }

                // Handle character-by-character sequences (both type and press)
                if ((action.action === 'type' || action.action === 'press') &&
                    action.args?.length >= 2 &&
                    typeof action.args[1] === 'string') {

                    if (selector !== currentSelector) {
                        if (currentSelector && currentValue) {
                            credentials[currentSelector] = {
                                value: currentValue,
                                type: currentType || 'text'
                            };
                        }
                        currentSelector = selector;
                        currentValue = credentials[selector]?.value || '';
                        currentType = action.args[2] || credentials[selector]?.type || 'text';
                    }

                    const character = action.args[1];

                    if (isPrintableCharacter(character)) {
                        currentValue += character;
                    } else if (character === 'Backspace') {
                        currentValue = currentValue.slice(0, -1);
                    }

                    if (!currentType && action.args[2]?.toLowerCase() === 'password') {
                        currentType = 'password';
                    }

                    let j = i + 1;
                    while (j < step.what.length) {
                        const nextAction = step.what[j];
                        if (!nextAction.action || !nextAction.args?.[0] ||
                            nextAction.args[0] !== selector ||
                            (nextAction.action !== 'type' && nextAction.action !== 'press')) {
                            break;
                        }
                        if (nextAction.args[1] === 'Backspace') {
                            currentValue = currentValue.slice(0, -1);
                        } else if (isPrintableCharacter(nextAction.args[1])) {
                            currentValue += nextAction.args[1];
                        }
                        j++;
                    }

                    credentials[currentSelector] = {
                        value: currentValue,
                        type: currentType
                    };

                    i = j;
                } else {
                    i++;
                }
            }

            if (currentSelector && currentValue) {
                credentials[currentSelector] = {
                    value: currentValue,
                    type: currentType || 'text'
                };
            }
        });

        return credentials;
    }

    const groupCredentialsByType = (credentials: Credentials): GroupedCredentials => {
        return Object.entries(credentials).reduce((acc: GroupedCredentials, [selector, info]) => {
            const credentialType = determineCredentialType(selector, info);

            switch (credentialType) {
                case 'password':
                    acc.passwords.push(selector);
                    break;
                case 'email':
                    acc.emails.push(selector);
                    break;
                case 'username':
                    acc.usernames.push(selector);
                    break;
                default:
                    acc.others.push(selector);
            }

            return acc;
        }, { passwords: [], emails: [], usernames: [], others: [] });
    };

    const getRobot = async () => {
        if (recordingId) {
            const robot = await getStoredRecording(recordingId);
            setRobot(robot);
        } else {
            notify('error', t('robot_edit.notifications.update_failed'));
        }
    };

    const handleClickShowPassword = (selector: string) => {
        setShowPasswords(prev => ({
            ...prev,
            [selector]: !prev[selector]
        }));
    };

    const handleRobotNameChange = (newName: string) => {
        setRobot((prev) =>
            prev ? { ...prev, recording_meta: { ...prev.recording_meta, name: newName } } : prev
        );
    };

    const handleCredentialChange = (selector: string, value: string) => {
        setCredentials(prev => ({
            ...prev,
            [selector]: {
                ...prev[selector],
                value
            }
        }));
    };

    const handleLimitChange = (newLimit: number) => {
        setRobot((prev) => {
            if (!prev) return prev;

            const updatedWorkflow = [...prev.recording.workflow];
            if (
                updatedWorkflow.length > 0 &&
                updatedWorkflow[0]?.what &&
                updatedWorkflow[0].what.length > 0 &&
                updatedWorkflow[0].what[0].args &&
                updatedWorkflow[0].what[0].args.length > 0 &&
                updatedWorkflow[0].what[0].args[0]
            ) {
                updatedWorkflow[0].what[0].args[0].limit = newLimit;
            }

            return { ...prev, recording: { ...prev.recording, workflow: updatedWorkflow } };
        });
    };

    const handleTargetUrlChange = (newUrl: string) => {
        setRobot((prev) => {
            if (!prev) return prev;

            const updatedWorkflow = [...prev.recording.workflow];
            const lastPairIndex = updatedWorkflow.length - 1;

            if (lastPairIndex >= 0) {
                const gotoAction = updatedWorkflow[lastPairIndex]?.what?.find(action => action.action === "goto");
                if (gotoAction && gotoAction.args && gotoAction.args.length > 0) {
                    gotoAction.args[0] = newUrl;
                }
            }

            return { ...prev, recording: { ...prev.recording, workflow: updatedWorkflow } };
        });
    };

    const renderAllCredentialFields = () => {
        return (
            <>
                {renderCredentialFields(
                    credentialGroups.usernames,
                    t('Username'),
                    'text'
                )}

                {renderCredentialFields(
                    credentialGroups.emails,
                    t('Email'),
                    'text'
                )}

                {renderCredentialFields(
                    credentialGroups.passwords,
                    t('Password'),
                    'password'
                )}

                {renderCredentialFields(
                    credentialGroups.others,
                    t('Other'),
                    'text'
                )}
            </>
        );
    };

    const renderCredentialFields = (selectors: string[], headerText: string, defaultType: 'text' | 'password' = 'text') => {
        if (selectors.length === 0) return null;

        return (
            <>
                {/* <Typography variant="h6" style={{ marginBottom: '20px' }}>
                    {headerText}
                </Typography> */}
                {selectors.map((selector, index) => {
                    const isVisible = showPasswords[selector];

                    return (
                        <TextField
                            key={selector}
                            type={isVisible ? 'text' : 'password'}
                            label={headerText === 'Other' ? `${`Input`} ${index + 1}` : headerText}
                            value={credentials[selector]?.value || ''}
                            onChange={(e) => handleCredentialChange(selector, e.target.value)}
                            style={{ marginBottom: '20px' }}
                            InputProps={{
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton
                                            aria-label="Show input"
                                            onClick={() => handleClickShowPassword(selector)}
                                            edge="end"
                                            disabled={!credentials[selector]?.value}
                                        >
                                            {isVisible ? <Visibility /> : <VisibilityOff />}
                                        </IconButton>
                                    </InputAdornment>
                                ),
                            }}
                        />
                    );
                })}
            </>
        );
    };

    const handleSave = async () => {
        if (!robot) return;

        try {
            const credentialsForPayload = Object.entries(credentials).reduce((acc, [selector, info]) => {
                const enforceType = info.type === 'password' ? 'password' : 'text';

                acc[selector] = {
                    value: info.value,
                    type: enforceType
                };
                return acc;
            }, {} as Record<string, CredentialInfo>);

            const lastPair = robot.recording.workflow[robot.recording.workflow.length - 1];
            const targetUrl = lastPair?.what.find(action => action.action === "goto")?.args?.[0];

            const payload = {
                name: robot.recording_meta.name,
                limit: robot.recording.workflow[0]?.what[0]?.args?.[0]?.limit,
                credentials: credentialsForPayload,
                targetUrl: targetUrl,
            };

            const success = await updateRecording(robot.recording_meta.id, payload);

            if (success) {
                setRerenderRobots(true);

                notify('success', t('robot_edit.notifications.update_success'));
                handleStart(robot);
                handleClose();
            } else {
                notify('error', t('robot_edit.notifications.update_failed'));
            }
        } catch (error) {
            notify('error', t('robot_edit.notifications.update_error'));
            console.error('Error updating robot:', error);
        }
    };

    const lastPair = robot?.recording.workflow[robot?.recording.workflow.length - 1];
    const targetUrl = lastPair?.what.find(action => action.action === "goto")?.args?.[0];

    return (
        <GenericModal
            isOpen={isOpen}
            onClose={handleClose}
            modalStyle={modalStyle}
        >
            <>
                <Typography variant="h5" style={{ marginBottom: '20px' }}>
                    {t('robot_edit.title')}
                </Typography>
                <Box style={{ display: 'flex', flexDirection: 'column' }}>
                    {robot && (
                        <>
                            <TextField
                                label={t('robot_edit.change_name')}
                                key="Robot Name"
                                type='text'
                                value={robot.recording_meta.name}
                                onChange={(e) => handleRobotNameChange(e.target.value)}
                                style={{ marginBottom: '20px' }}
                            />

                            <TextField
                                label="Robot Target URL"
                                key="Robot Target URL"
                                type='text'
                                value={targetUrl || ''}
                                onChange={(e) => handleTargetUrlChange(e.target.value)}
                                style={{ marginBottom: '20px' }}
                            />

                            {robot.recording.workflow?.[0]?.what?.[0]?.args?.[0]?.limit !== undefined && (
                                <TextField
                                    label={t('robot_edit.robot_limit')}
                                    type="number"
                                    value={robot.recording.workflow[0].what[0].args[0].limit || ''}
                                    onChange={(e) => {
                                        const value = parseInt(e.target.value, 10);
                                        if (value >= 1) {
                                            handleLimitChange(value);
                                        }
                                    }}
                                    inputProps={{ min: 1 }}
                                    style={{ marginBottom: '20px' }}
                                />
                            )}

                            {(Object.keys(credentials).length > 0) && (
                                <>
                                    <Typography variant="body1" style={{ marginBottom: '20px' }}>
                                        {t('Input Texts')}
                                    </Typography>
                                    {renderAllCredentialFields()}
                                </>
                            )}

                            <Box mt={2} display="flex" justifyContent="flex-end">
                                <Button variant="contained" color="primary" onClick={handleSave}>
                                    {t('robot_edit.save')}
                                </Button>
                                <Button
                                    onClick={handleClose}
                                    color="primary"
                                    variant="outlined"
                                    style={{ marginLeft: '10px' }}
                                    sx={{
                                        color: '#ff00c3 !important',
                                        borderColor: '#ff00c3 !important',
                                        backgroundColor: 'whitesmoke !important',
                                    }}>
                                    {t('robot_edit.cancel')}
                                </Button>
                            </Box>
                        </>
                    )}
                </Box>
            </>
        </GenericModal>
    );
};