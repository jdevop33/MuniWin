import { Box, Button, Stack, Typography, CircularProgress } from "@mui/material";
import React, { useCallback, useEffect, useState } from "react";
import { interpretCurrentRecording } from "../../api/recording";
import { useSocketStore } from "../../context/socket";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { GenericModal } from "../ui/GenericModal";
import { WhereWhatPair } from "maxun-core";
import HelpIcon from '@mui/icons-material/Help';
import { useTranslation } from "react-i18next";

interface InterpretationButtonsProps {
  enableStepping: (isPaused: boolean) => void;
}

interface InterpretationInfo {
  running: boolean;
  isPaused: boolean;
}

const interpretationInfo: InterpretationInfo = {
  running: false,
  isPaused: false,
};

export const InterpretationButtons = ({ enableStepping }: InterpretationButtonsProps) => {
  const { t } = useTranslation();
  const [info, setInfo] = useState<InterpretationInfo>(interpretationInfo);
  const [decisionModal, setDecisionModal] = useState<{
    pair: WhereWhatPair | null,
    actionType: string,
    selector: string,
    tagName: string,
    innerText: string,
    action: string,
    open: boolean
  }>({ pair: null, actionType: '', selector: '', action: '', tagName: '', innerText: '', open: false });

  const { socket } = useSocketStore();
  const { notify } = useGlobalInfoStore();

  const finishedHandler = useCallback(() => {
    setInfo({ ...info, isPaused: false });
    enableStepping(false);
  }, [info, enableStepping]);

  const breakpointHitHandler = useCallback(() => {
    setInfo({ running: false, isPaused: true });
    notify('warning', t('interpretation_buttons.messages.restart_required'));
    enableStepping(true);
  }, [enableStepping, t]);

  const decisionHandler = useCallback(
    ({ pair, actionType, lastData }: { pair: WhereWhatPair | null, actionType: string, lastData: { selector: string, action: string, tagName: string, innerText: string } }) => {
      const { selector, action, tagName, innerText } = lastData;
      setDecisionModal((prevState) => ({
        pair,
        actionType,
        selector,
        action,
        tagName,
        innerText,
        open: true,
      }));
    }, []);

  const handleDecision = (decision: boolean) => {
    const { pair, actionType } = decisionModal;
    socket?.emit('decision', { pair, actionType, decision });
    setDecisionModal({ pair: null, actionType: '', selector: '', action: '', tagName: '', innerText: '', open: false });
  };

  const handleDescription = () => {
    if (decisionModal.actionType === 'customAction') {
      return (
        <>
          <Typography>
            {t('interpretation_buttons.modal.use_previous')}
          </Typography>
          <Box style={{ marginTop: '4px' }}>
            <Typography>
              {t('interpretation_buttons.modal.previous_action')} <b>{decisionModal.action}</b>,
              {t('interpretation_buttons.modal.element_text')} <b>{decisionModal.innerText}</b>
            </Typography>
          </Box>
        </>
      );
    }
    return null;
  };

  useEffect(() => {
    if (socket) {
      socket.on('finished', finishedHandler);
      socket.on('breakpointHit', breakpointHitHandler);
      socket.on('decision', decisionHandler);
    }
    return () => {
      socket?.off('finished', finishedHandler);
      socket?.off('breakpointHit', breakpointHitHandler);
      socket?.off('decision', decisionHandler);
    };
  }, [socket, finishedHandler, breakpointHitHandler]);

  const handlePlay = async () => {
    if (!info.running) {
      setInfo({ ...info, running: true });
      const finished = await interpretCurrentRecording();
      setInfo({ ...info, running: false });
      if (finished) {
        notify('info', t('interpretation_buttons.messages.run_finished'));
      } else {
        notify('error', t('interpretation_buttons.messages.run_failed'));
      }
    }
  };

  // pause and stop logic (do not delete - we wil bring this back!)
  /*
  const handlePause = async () => {
    if (info.running) {
      socket?.emit("pause");
      setInfo({ running: false, isPaused: true });
      notify('warning', 'Please restart the interpretation after updating the recording');
      enableStepping(true);
    }
  };

  const handleStop = async () => {
    setInfo({ running: false, isPaused: false });
    enableStepping(false);
    await stopCurrentInterpretation();
  };
  */

  return (
    <Stack direction="row" spacing={3} sx={{ marginTop: '30px', marginBottom: '5px', justifyContent: 'center' }}>
      <Button
        variant="contained"
        color="primary"
        onClick={handlePlay}
        disabled={info.running}
        sx={{ display: 'grid' }}
      >
        {info.running ? (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <CircularProgress size={22} color="inherit" sx={{ marginRight: '10px' }} />
            {t('interpretation_buttons.messages.extracting')}
          </Box>
        ) : t('interpretation_buttons.buttons.preview')}
      </Button>
      <GenericModal
        onClose={() => { }}
        isOpen={decisionModal.open}
        canBeClosed={false}
        modalStyle={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 500,
          background: 'white',
          border: '2px solid #000',
          boxShadow: '24',
          height: 'fit-content',
          display: 'block',
          overflow: 'scroll',
          padding: '5px 25px 10px 25px',
        }}
      >
        <div style={{ padding: '15px' }}>
          <HelpIcon />
          {handleDescription()}
          <div style={{ float: 'right' }}>
            <Button onClick={() => handleDecision(true)} color='success'>
              {t('interpretation_buttons.buttons.yes')}
            </Button>
            <Button onClick={() => handleDecision(false)} color='error'>
              {t('interpretation_buttons.buttons.no')}
            </Button>
          </div>
        </div>
      </GenericModal>
    </Stack>
  );
};
